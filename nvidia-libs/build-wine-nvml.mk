##
## wine-nvml
##

ifeq ($(findstring nvml,$(WITHOUT_NVIDIA_LIBS)),)

# This rule ships only with the CachyOS variant source tree. The Standard tree
# has no nvidia-libs directory and no NVML build rule, so it needs no matching
# header preparation and silently gains no dependency.
#
# The upstream generator downloads nvml.h from a mutable upstream tag and
# verifies no checksum. nexus/build-runtime.mjs runs the host preflight that
# binds the audited lock to the real module Git identity and stages the verified
# header before any SDK recipe starts. The container step below requires that
# proof, re-validates it against the current source, lock and generator inputs,
# and passes the version explicitly, so the generator always uses the verified
# local file and never falls back to its tag based download. The packaged
# version metadata also comes from that validated proof, so this rule runs no
# Git command inside the container.
#
# A build that enters the SDK container without the host proof fails with the
# exact host preflight command instead of pretending the pin was checked:
#   $(NVML_HEADER_PREPARE) host-prepare --source $(SRCDIR) --proof $(NVML_HEADER_PROOF)
NVML_VERSION = 610.43.02
NVML_HEADER_LOCK = $(SRCDIR)/nexus/nvml-header.lock.json
NVML_HEADER_PREPARE = $(SRCDIR)/nexus/prepare-nvml-header.sh
NVML_HEADER_PROOF = $(OBJ)/nvml-header-proof.json

NVML_SO_x86_64_MESON_ARGS = \
  --cross-file=$(NVML_SO_SRC)/cross-wine64.txt \
  --libdir=lib/wine/nvidia-libs/nvml

NVML_DLL_x86_64_MESON_ARGS = \
  --cross-file=$(NVML_DLL_SRC)/cross-mingw64.txt \
  --libdir=lib/wine/nvidia-libs/nvml

NVML_SO_DEPENDS = wine
NVML_SO_HOST_DEPENDS = wine
NVML_DLL_DEPENDS = wine
NVML_DLL_HOST_DEPENDS = wine

$(eval $(call rules-source,nvml_so,$(SRCDIR)/nvidia-libs/wine-nvml))
$(eval $(call rules-meson-wine,nvml_so,x86_64,unix))
$(eval $(call rules-source,nvml_dll,$(SRCDIR)/nvidia-libs/wine-nvml))
$(eval $(call rules-meson-wine,nvml_dll,x86_64,windows))

$(OBJ)/.nvml_so-post-source: $(NVML_HEADER_PREPARE) $(NVML_HEADER_LOCK)
	$(NVML_HEADER_PREPARE) prepare --source $(SRCDIR) --version $(NVML_VERSION) --proof $(NVML_HEADER_PROOF) --dest $(NVML_SO_SRC)/src
	cd $(NVML_SO_SRC)/src && ./make_nvml $(NVML_VERSION)
	mkdir -p $(DST_LIBDIR)/wine/nvidia-libs/nvml
	rm -rf $(DST_LIBDIR)/wine/nvidia-libs/nvml/version
	$(NVML_HEADER_PREPARE) version --source $(SRCDIR) --version $(NVML_VERSION) --proof $(NVML_HEADER_PROOF) > $(DST_LIBDIR)/wine/nvidia-libs/nvml/version
	touch $@

$(OBJ)/.nvml_dll-post-source: $(NVML_HEADER_PREPARE) $(NVML_HEADER_LOCK)
	$(NVML_HEADER_PREPARE) prepare --source $(SRCDIR) --version $(NVML_VERSION) --proof $(NVML_HEADER_PROOF) --dest $(NVML_DLL_SRC)/src
	cd $(NVML_DLL_SRC)/src && ./make_nvml $(NVML_VERSION)
	mkdir -p $(DST_LIBDIR)/wine/nvidia-libs/nvml
	rm -rf $(DST_LIBDIR)/wine/nvidia-libs/nvml/version
	$(NVML_HEADER_PREPARE) version --source $(SRCDIR) --version $(NVML_VERSION) --proof $(NVML_HEADER_PROOF) > $(DST_LIBDIR)/wine/nvidia-libs/nvml/version
	touch $@

default_pfx: nvml_so nvml_dll

endif # WITHOUT_NVIDIA_LIBS
