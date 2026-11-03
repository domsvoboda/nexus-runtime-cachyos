"""Exercise the actual Proton ARM environment block without running Wine."""
import ast
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace

source = Path(__file__).resolve().parents[2] / "proton"
tree = ast.parse(source.read_text())
session = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "Session")
setup = next(node for node in session.body if isinstance(node, ast.FunctionDef) and node.name == "init_session")
block = next(node for node in ast.walk(setup) if isinstance(node, ast.If) and
             ast.unparse(node.test) == "platform.machine() == 'aarch64'")
code = compile(ast.fix_missing_locations(ast.Module(body=[block], type_ignores=[])), str(source), "exec")

with tempfile.TemporaryDirectory(prefix="nexus-proton-fex-") as temporary:
    root = Path(temporary)
    dist = root / "runtime"
    dist.mkdir()
    (dist / "canary").write_text("unchanged")
    for number, (arch, overrides) in enumerate([
        ("aarch64", {}),
        ("aarch64", {"FEX_APP_CONFIG_LOCATION": "/explicit/", "FEX_APP_CONFIG": "/explicit.json", "FEX_DISKCACHE": "0"}),
        ("aarch64", {"FEX_APP_CONFIG_LOCATION": "", "FEX_APP_CONFIG": "", "FEX_DISKCACHE": ""}),
        ("x86_64", {}),
    ]):
        prefix = root / str(number)
        prefix.mkdir()
        config = prefix / "proton-fex-config.json"
        env = dict(overrides)
        current = SimpleNamespace(env=env, generate_fex_app_config=lambda: {"Config": {}, "ThunksDB": {}})
        namespace = {"self": current, "platform": SimpleNamespace(machine=lambda: arch), "os": SimpleNamespace(environ={}, path=os.path), "json": json,
                     "g_proton": SimpleNamespace(dist_dir=str(dist)),
                     "g_compatdata": SimpleNamespace(fex_config_file=str(config), path=lambda name: str(prefix / name)),
                     "makedirs": lambda directory: Path(directory).mkdir(parents=True, exist_ok=True)}
        exec(code, namespace)
        if arch == "x86_64":
            assert env == {} and not config.exists()
        elif overrides:
            assert env == overrides and not config.exists()
        else:
            assert env["FEX_APP_CONFIG_LOCATION"] == str(prefix / "fex-emu")
            assert (prefix / "fex-emu" / "AppConfig").is_dir()
            assert json.loads(config.read_text()) == {"Config": {}, "ThunksDB": {}}
            assert env["FEX_DISKCACHE"] == "1"
        assert sorted(item.name for item in dist.iterdir()) == ["canary"]
        assert (dist / "canary").read_text() == "unchanged"
print("PASS actual Proton ARM setup, explicit and empty overrides, x86 isolation, immutable runtime")
