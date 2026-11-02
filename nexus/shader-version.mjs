// SPDX-License-Identifier: MIT
export function requireShaderVersion(source,expected){
  const match=/^\s*AC_INIT\(\s*\[vkd3d\]\s*,\s*\[([0-9.]+)\]/m.exec(source);
  if(!match||match[1]!==expected)throw Error('Pinned shader source version mismatch');
}
