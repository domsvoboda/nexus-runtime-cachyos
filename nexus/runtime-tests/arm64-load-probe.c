/* SPDX-License-Identifier: MIT */
/* Loads the prefix's xgameruntime.dll and resolves the C++ runtime entry
 * points. Built for aarch64, x86_64 (ARM64EC/FEX) and i386 (WoW64/FEX). */
#include <windows.h>
#include <stdio.h>
#include <string.h>

typedef BOOL (WINAPI *is_wow64_process2_fn)(HANDLE, USHORT *, USHORT *);

int main(void)
{
    static const char *const exports[] = {"QueryApiImpl", "InitializeApiImpl", "InitializeApiImplEx",
                                          "InitializeApiImplEx2", "UninitializeApiImpl"};
    char module_path[MAX_PATH] = {0};
    USHORT process = 0, native = 0;
    is_wow64_process2_fn is_wow64_process2;
    unsigned int i, failures = 0;
    HMODULE module;

    is_wow64_process2 = (is_wow64_process2_fn)GetProcAddress(GetModuleHandleA("kernel32.dll"), "IsWow64Process2");
    if (!is_wow64_process2 || !is_wow64_process2(GetCurrentProcess(), &process, &native))
    {
        printf("MACHINE unavailable\nRESULT FAIL\n");
        return 1;
    }
    printf("MACHINE process=0x%04x native=0x%04x\n", process, native);
    if (native != IMAGE_FILE_MACHINE_ARM64) failures++;

    module = LoadLibraryA("xgameruntime.dll");
    if (!module)
    {
        printf("LOAD failed error=%lu\nRESULT FAIL\n", GetLastError());
        return 1;
    }
    GetModuleFileNameA(module, module_path, sizeof(module_path));
    printf("MODULE %s\n", module_path);
    printf("BUILTIN %s\n", !memcmp((const char *)module + 64, "Wine builtin DLL", 16) ? "yes" : "no");
    if (memcmp((const char *)module + 64, "Wine builtin DLL", 16)) failures++;
    for (i = 0; i < sizeof(exports) / sizeof(exports[0]); i++)
    {
        if (GetProcAddress(module, exports[i])) printf("EXPORT %s ok\n", exports[i]);
        else { printf("EXPORT %s missing\n", exports[i]); failures++; }
    }
    printf("RESULT %s\n", failures ? "FAIL" : "PASS");
    return failures ? 1 : 0;
}
