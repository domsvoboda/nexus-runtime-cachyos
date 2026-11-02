/* SPDX-License-Identifier: MIT
 * Real CONCRT export, same fixture for Wine and a private native reference.
 * No timing/performance guarantee or scheduler identity manufactured here. */
#include <windows.h>
#include <stdio.h>
#include <string.h>
typedef struct context { void **vtable; } context;
static void (__cdecl *yield_thread)(void);
static context *(__cdecl *current_context)(void);
static unsigned int (__cdecl *context_id)(void);
static LONG checks, failures, callbacks, progress;
static context *expected_context;
static HANDLE gate;
static void check(int ok, const char *name)
{
    ++checks;
    if (!ok && ++failures <= 20) printf("FAIL %s\n", name);
}
static LONG CALLBACK stub_exception(EXCEPTION_POINTERS *exception)
{
    if (exception->ExceptionRecord->ExceptionCode == 0x80000100) {
        check(0, "required CONCRT export is an unimplemented stub");
        printf("CHECKS %ld FAILURES %ld\n", checks, failures);
        ExitProcess(2);
    }
    return EXCEPTION_CONTINUE_SEARCH;
}
static void __thiscall spin_yield(context *ctx)
{
    check(ctx == expected_context, "custom SpinYield receives exact context");
    ++callbacks;
}
static DWORD WINAPI worker(void *arg)
{
    unsigned i;
    (void)arg;
    WaitForSingleObject(gate, INFINITE);
    for (i = 0; i < 10000; ++i) {
        InterlockedIncrement(&progress);
        yield_thread();
    }
    return 0;
}
int main(int argc, char **argv)
{
    HMODULE dll;
    context *ctx;
    void **original, *custom[9];
    HANDLE threads[4];
    unsigned int id, i;
    AddVectoredExceptionHandler(1, stub_exception);
    dll = LoadLibraryA(argc > 1 ? argv[1] : "concrt140.dll");
    check(dll != NULL, "load CONCRT");
    if (!dll) return 2;
    yield_thread = (void *)GetProcAddress(dll, "?_UnderlyingYield@details@Concurrency@@YAXXZ");
    context_id = (void *)GetProcAddress(dll, "?Id@Context@Concurrency@@SAIXZ");
#ifdef _WIN64
    current_context = (void *)GetProcAddress(dll, "?CurrentContext@Context@Concurrency@@SAPEAV12@XZ");
#else
    current_context = (void *)GetProcAddress(dll, "?CurrentContext@Context@Concurrency@@SAPAV12@XZ");
#endif
    check(yield_thread && context_id && current_context, "required exports present");
    if (!yield_thread || !context_id || !current_context) return 2;
    id = context_id();
    check(id == ~0u, "fresh thread has no CONCRT context");
    for (i = 0; i < 10000; ++i) yield_thread();
    check(context_id() == id, "yield does not allocate context");
    ctx = current_context();
    check(ctx != NULL, "explicit context creation");
    if (!ctx) return 2;
    id = context_id();
    for (i = 0; i < 10000; ++i) yield_thread();
    check(current_context() == ctx && context_id() == id, "existing context retained");
    original = ctx->vtable;
    memcpy(custom, original, sizeof(custom));
    custom[8] = (void *)spin_yield;
    expected_context = ctx;
    ctx->vtable = custom;
    for (i = 0; i < 1000; ++i) yield_thread();
    ctx->vtable = original;
    check(callbacks == 1000, "custom context dispatches SpinYield exactly once per call");
    gate = CreateEventA(NULL, TRUE, FALSE, NULL);
    check(gate != NULL, "worker gate");
    for (i = 0; i < 4; ++i) {
        threads[i] = CreateThread(NULL, 0, worker, NULL, 0, NULL);
        check(threads[i] != NULL, "yield worker created");
        if (!threads[i]) return 2;
    }
    SetEvent(gate);
    check(WaitForMultipleObjects(4, threads, TRUE, 15000) == WAIT_OBJECT_0, "all yield workers complete");
    check(progress == 40000, "all worker updates preserved");
    for (i = 0; i < 4; ++i) CloseHandle(threads[i]);
    CloseHandle(gate);
    printf("CHECKS %ld FAILURES %ld\n", checks, failures);
    return failures ? 1 : 0;
}
