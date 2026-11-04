# parameters:
#   $(1): lowercase package name
#   $(2): uppercase package name
#   $(3): build target arch
#   $(4): build target os
#
define create-rules-meson-wine
$(call create-rules-common,$(1),$(2),$(3),$(4))
ifneq ($(findstring $(3)-$(4),$(ARCHS)),)

$(2)_MESON_ARGS = -Db_ndebug=true --buildtype=release --strip

# A later PATH assignment overrides the HOST_DEPENDS PATH set by
# rules-common, so the declared host dependency tool directories and the
# inherited PATH are repeated here instead of being dropped. Ordering: the
# target wine bin keeps the existing target runtime/tool selection, then the
# host-arch dependency tools, then the inherited PATH. Cross-arch targets have
# no compiler of their own: winegcc is built only for the host architecture
# (rules-wine-tools points --with-wine-tools at the host object tree), so it
# resolves from the host-arch wine tools directory.
# Current consumers and their HOST_DEPENDS (all wine):
#   nvenc, nvenc32, nvcuda, nvcuda32, nvml_so, nvml_dll, nvoptix, hipwine.
$(2)_$(3)_ENV += \
	PATH="$$(WINE_$(3)_DST)/bin:$$(call list-join,:,$$(foreach d,$$($(2)_$(3)_HOST_DEPS),$$($$(d)_$$(HOST_ARCH)_BINDIR)),,:)$$$$PATH"

$$($(2)_SRC)/meson.build: | $$(OBJ)/.$(1)-post-source

# Wine winelib modules are ELF shared objects even when installed under a
# windows-side directory. winegcc picks the first archive of a name across -L
# directories without distinguishing ELF from PE archives, and it only knows its
# own (host-arch) wine prefix. For a cross-arch winelib target the target-arch
# wine tools directory is on PATH, but the target-arch unix import/CRT archives
# are not in winegcc's search path, so add the target-arch wine unix archive
# directory through a generated copy of the checked-in cross file. The copy
# preserves every existing cross flag (-m32/-m64, -mwindows and the rest) and
# only prepends the archive directory to c_link_args. A MinGW PE cross file
# (array compiler with an explicit -b backend) is copied unchanged so PE
# consumer semantics stay intact.
$(2)_$(3)_WINE_CROSS := $$(patsubst --cross-file=%,%,$$(filter --cross-file=%,$$($(2)_$(3)_MESON_ARGS)))
$(2)_$(3)_WINE_MESON_ARGS := $$($(2)_$(3)_MESON_ARGS)
ifneq ($$($(2)_$(3)_WINE_CROSS),)
# The checked-in cross file is synced by the package post-source step, so that
# step stays order-only and a helper target makes the cross file itself the
# normal prerequisite: a cross file edit or re-sync regenerates the overlay.
$$($(2)_$(3)_WINE_CROSS): | $$(OBJ)/.$(1)-post-source

$$(OBJ)/.$(1)-$(3)-cross-wine.txt: $$($(2)_$(3)_WINE_CROSS)
	@{ if grep -Eq "^c[[:space:]]*=[[:space:]]*'winegcc'" "$$($(2)_$(3)_WINE_CROSS)"; then \
	     if [ "$$$$(grep -c '^c_link_args = ' "$$($(2)_$(3)_WINE_CROSS)")" != "1" ] || \
	        [ "$$$$(grep -Ec "^c_link_args = \[[[:space:]]*('[^']*'[[:space:]]*(,[[:space:]]*'[^']*'[[:space:]]*)*)?\][[:space:]]*(#.*)?$$$$" "$$($(2)_$(3)_WINE_CROSS)")" != "1" ]; then \
	       echo "unsupported winegcc c_link_args syntax: $$($(2)_$(3)_WINE_CROSS)" >&2; exit 1; \
	     fi; \
	     sed "s|^c_link_args = \\[|c_link_args = ['-L$$(WINE_$(3)_DST)/lib/wine/$(3)-unix', |" "$$($(2)_$(3)_WINE_CROSS)" > "$$@.tmp"; \
	     if [ "$$$$(grep -c '^c_link_args = ' "$$@.tmp")" != "1" ] || \
	        [ "$$$$(grep -Ec "^c_link_args = \[[[:space:]]*('[^']*'[[:space:]]*(,[[:space:]]*'[^']*'[[:space:]]*)*)?\][[:space:]]*(#.*)?$$$$" "$$@.tmp")" != "1" ] || \
	        ! grep -Fq "'-L$$(WINE_$(3)_DST)/lib/wine/$(3)-unix', " "$$@.tmp"; then \
	       echo "wine cross overlay verification failed: $$($(2)_$(3)_WINE_CROSS)" >&2; rm -f "$$@.tmp"; exit 1; \
	     fi; \
	   else cp "$$($(2)_$(3)_WINE_CROSS)" "$$@.tmp"; fi; }
	mv "$$@.tmp" "$$@"

$$(OBJ)/.$(1)-$(3)-configure: $$(OBJ)/.$(1)-$(3)-cross-wine.txt
$(2)_$(3)_WINE_MESON_ARGS := $$(filter-out --cross-file=%,$$($(2)_$(3)_MESON_ARGS)) --cross-file=$$(OBJ)/.$(1)-$(3)-cross-wine.txt
endif

$$(OBJ)/.$(1)-$(3)-configure: $$($(2)_SRC)/meson.build meson-source $$(OBJ)/.wine-$(3)-tools
	@echo ":: configuring $(1)-$(3)..." >&2
	rm -rf "$$($(2)_$(3)_OBJ)/meson-private/coredata.dat"

	env $$($(2)_$(3)_ENV) \
	$$(OBJ)/src-meson/meson.py "$$($(2)_$(3)_OBJ)" "$$($(2)_SRC)" \
	      --prefix="$$($(2)_$(3)_DST)" \
	      --buildtype=release \
	      $$($(3)-$(4)_MESON_ARGS) \
	      $$($(2)_MESON_ARGS) \
	      $$($(2)_$(3)_WINE_MESON_ARGS) \
	      $$(MESON_STRIP_ARG)

	touch $$@

$$(OBJ)/.$(1)-$(3)-build:
	@echo ":: building $(1)-$(3)..." >&2
	+env $$($(2)_$(3)_ENV) \
	ninja -C "$$($(2)_$(3)_OBJ)" install
	touch $$@
endif
endef

rules-meson-wine = $(call create-rules-meson-wine,$(1),$(call toupper,$(1)),$(2),$(3))
