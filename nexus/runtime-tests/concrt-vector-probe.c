/* SPDX-License-Identifier: MIT
 * Actual DLL exports only. No source replacement, account, game or cloud access.
 * Allocators receive element counts, not bytes, under the Microsoft ABI. */
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

typedef struct vector vector;
struct vector {
    void *(__cdecl *allocator)(vector *, size_t);
    void *storage[3];
    size_t first_block, early_size;
    void **segment;
};
typedef void (__cdecl *clear_fn)(void *, size_t);
typedef void (__cdecl *copy_fn)(void *, const void *, size_t);
typedef struct {
    vector v;
    size_t width, allocations, counts[64];
    void *blocks[64];
    CRITICAL_SECTION cs;
    volatile LONG delay_next;
    HANDLE entered, release;
} fixture;
static void (__thiscall *reserve_call)(vector *, size_t, size_t, size_t);
static void *(__thiscall *push_call)(vector *, size_t, size_t *);
static size_t (__thiscall *capacity_call)(const vector *);
static void (__thiscall *destroy_call)(vector *);
static size_t (__thiscall *grow_call)(vector *, size_t, size_t, copy_fn, const void *);
static size_t (__thiscall *grow_to_call)(vector *, size_t, size_t, copy_fn, const void *);
static void (__thiscall *resize_call)(vector *, size_t, size_t, size_t, clear_fn, copy_fn, const void *);
static void (__thiscall *assign_call)(vector *, const vector *, size_t, clear_fn, copy_fn, copy_fn);
static LONG checks, failures;
static fixture *callback_dst, *callback_src;

static void check(int condition, const char *message)
{
    InterlockedIncrement(&checks);
    if (!condition && InterlockedIncrement(&failures) <= 40) printf("FAIL %s\n", message);
}
static int contains(fixture *f, const void *p, size_t count)
{
    size_t i, bytes;
    uintptr_t value = (uintptr_t)p;
    if (!count) return 1;
    if (!p || p == (void *)1 || count > SIZE_MAX / f->width) return 0;
    bytes = count * f->width;
    for (i = 0; i < f->allocations; i++) {
        uintptr_t start = (uintptr_t)f->blocks[i];
        size_t length = f->counts[i] * f->width;
        if (value >= start && value - start <= length && bytes <= length - (value - start)) return 1;
    }
    return 0;
}
static void * __cdecl allocate(vector *v, size_t count)
{
    fixture *f = (fixture *)v;
    void *p;
    if (!count || count > 1048576 || count > SIZE_MAX / f->width) ExitProcess(90);
    if (InterlockedCompareExchange(&f->delay_next, 0, 1) == 1) {
        SetEvent(f->entered);
        if (WaitForSingleObject(f->release, 5000) != WAIT_OBJECT_0) ExitProcess(91);
    }
    p = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, count * f->width);
    if (!p) ExitProcess(92);
    EnterCriticalSection(&f->cs);
    if (f->allocations == 64) ExitProcess(93);
    f->blocks[f->allocations] = p;
    f->counts[f->allocations++] = count;
    LeaveCriticalSection(&f->cs);
    return p;
}
static void init(fixture *f, size_t width)
{
    memset(f, 0, sizeof(*f));
    f->v.allocator = allocate;
    f->v.segment = f->v.storage;
    f->width = width;
    InitializeCriticalSection(&f->cs);
}
static void dispose(fixture *f)
{
    size_t i;
    destroy_call(&f->v);
    for (i = 0; i < f->allocations; i++) HeapFree(GetProcessHeap(), 0, f->blocks[i]);
    DeleteCriticalSection(&f->cs);
}
static void *slot(fixture *f, size_t index)
{
    size_t seg = 0, n = index;
    while (n >>= 1) seg++;
    return (unsigned char *)f->v.segment[seg] + f->width * (index - (seg ? (size_t)1 << seg : 0));
}
static unsigned char pattern(size_t index) { return (unsigned char)(index * 17 + 7); }
static void fill_slot(fixture *f, void *p, size_t index)
{
    int valid = contains(f, p, 1);
    check(valid, "push returned allocated element, not allocation marker");
    if (valid) {
        uint64_t unique = index;
        memset(p, pattern(index), f->width);
        memcpy(p, &unique, sizeof(unique));
    }
}
static void seed(fixture *f, size_t count)
{
    size_t i, index;
    for (i = 0; i < count; i++) {
        void *p = push_call(&f->v, f->width, &index);
        check(index == i, "sequential push index");
        fill_slot(f, p, i);
    }
}
static void verify_pattern(fixture *f, size_t count)
{
    size_t i, j;
    for (i = 0; i < count; i++) {
        unsigned char *p = slot(f, i);
        int valid = contains(f, p, 1);
        check(valid, "segment points inside actual allocation");
        if (!valid) continue;
        uint64_t unique;
        memcpy(&unique, p, sizeof(unique));
        check(unique == i, "unique element index is not duplicated or overwritten");
        for (j = sizeof(unique); j < f->width; j++) if (p[j] != pattern(i)) break;
        check(j == f->width, "element bytes preserved across segment boundaries");
    }
}
static void __cdecl repeat_copy(void *dst, const void *value, size_t count)
{
    size_t i;
    int valid = contains(callback_dst, dst, count);
    check(valid, "grow destination byte offset is within allocation");
    if (!valid) return;
    for (i = 0; i < count; i++) memcpy((unsigned char *)dst + i * callback_dst->width, value, callback_dst->width);
}
static void __cdecl range_copy(void *dst, const void *src, size_t count)
{
    int valid = contains(callback_dst, dst, count) && contains(callback_src, src, count);
    check(valid, "assignment source and destination byte offsets are valid");
    if (valid) memcpy(dst, src, count * callback_dst->width);
}
static void __cdecl clear_elements(void *dst, size_t count)
{
    int valid = contains(callback_dst, dst, count);
    check(valid, "resize/assignment clear uses byte offsets within allocation");
    if (valid) memset(dst, 0, count * callback_dst->width);
}
static void layout_and_callbacks(size_t width)
{
    fixture f, source;
    unsigned char value[256];
    size_t i, index, old;
    init(&f, width);
    reserve_call(&f.v, 64, width, SIZE_MAX / width);
    check(f.allocations == 1 && f.counts[0] == 64, "allocator receives element count, not byte count");
    check(capacity_call(&f.v) == 64, "reserve capacity");
    seed(&f, 257);
    verify_pattern(&f, 257);
    dispose(&f);

    init(&f, width);
    callback_dst = &f;
    memset(value, 0x31, width);
    check(grow_call(&f.v, 3, width, repeat_copy, value) == 0, "grow-by returns previous size");
    memset(value, 0x56, width);
    check(grow_call(&f.v, 2, width, repeat_copy, value) == 3, "grow-by starts at partial segment offset");
    memset(value, 0x7a, width);
    old = grow_to_call(&f.v, 9, width, repeat_copy, value);
    check(old == 5 && f.v.early_size == 9, "grow-to returns previous size");
    for (i = 0; i < 9; i++) {
        unsigned char *p = slot(&f, i), expected = i < 3 ? 0x31 : i < 5 ? 0x56 : 0x7a;
        check(contains(&f, p, 1) && p[0] == expected && p[width - 1] == expected, "grow operations preserve existing and new values");
    }
    check(grow_to_call(&f.v, 4, width, repeat_copy, value) == 9, "smaller grow-to is a no-op");
    resize_call(&f.v, 5, width, SIZE_MAX / width, clear_elements, repeat_copy, value);
    check(f.v.early_size == 5, "resize shrinks size");
    resize_call(&f.v, 0, width, SIZE_MAX / width, clear_elements, repeat_copy, value);
    check(f.v.early_size == 0, "resize clears vector");
    dispose(&f);

    init(&f, width); init(&source, width);
    seed(&f, 3); seed(&source, 7);
    callback_dst = &f; callback_src = &source;
    assign_call(&f.v, &source.v, width, clear_elements, range_copy, range_copy);
    check(f.v.early_size == 7, "assignment grows size");
    verify_pattern(&f, 7); verify_pattern(&source, 7);
    source.v.early_size = 5;
    assign_call(&f.v, &source.v, width, clear_elements, range_copy, range_copy);
    check(f.v.early_size == 5, "assignment shrinks within partial segment");
    verify_pattern(&f, 5); verify_pattern(&source, 5);
    index = 0;
    old = f.v.early_size;
    check(contains(&f, push_call(&f.v, width, &index), 1) && index == old, "push remains usable after assignment");
    dispose(&source); dispose(&f);
}
typedef struct { fixture *f; size_t count, index; void *result; HANDLE entered; } worker;
static DWORD WINAPI reserve_worker(void *arg)
{
    worker *w = arg;
    reserve_call(&w->f->v, w->count + 1, w->f->width, SIZE_MAX / w->f->width);
    return 0;
}
static DWORD WINAPI push_worker(void *arg)
{
    worker *w = arg;
    SetEvent(w->entered);
    w->result = push_call(&w->f->v, w->f->width, &w->index);
    return 0;
}
static void allocation_race(size_t boundary)
{
    fixture f;
    worker a = {0}, b = {0};
    HANDLE ta, tb;
    DWORD state;
    init(&f, 88); seed(&f, boundary);
    f.entered = CreateEventW(NULL, TRUE, FALSE, NULL);
    f.release = CreateEventW(NULL, TRUE, FALSE, NULL);
    a.f = b.f = &f; a.count = boundary;
    b.entered = CreateEventW(NULL, TRUE, FALSE, NULL);
    InterlockedExchange(&f.delay_next, 1);
    ta = CreateThread(NULL, 0, reserve_worker, &a, 0, NULL);
    if (WaitForSingleObject(f.entered, 3000) != WAIT_OBJECT_0) ExitProcess(94);
    check(capacity_call(&f.v) == boundary, "allocation-in-progress marker is not usable capacity");
    tb = CreateThread(NULL, 0, push_worker, &b, 0, NULL);
    if (WaitForSingleObject(b.entered, 3000) != WAIT_OBJECT_0) ExitProcess(95);
    state = WaitForSingleObject(tb, 100);
    check(state == WAIT_TIMEOUT, "push waits for allocation publication");
    SetEvent(f.release);
    if (WaitForSingleObject(ta, 3000) != WAIT_OBJECT_0 || WaitForSingleObject(tb, 3000) != WAIT_OBJECT_0) ExitProcess(96);
    check(b.index == boundary, "concurrent push index preserved");
    check(b.result == slot(&f, boundary) && contains(&f, b.result, 1), "concurrent push returns allocated element, never marker 1");
    fill_slot(&f, b.result, boundary); verify_pattern(&f, boundary + 1);
    CloseHandle(ta); CloseHandle(tb); CloseHandle(b.entered); CloseHandle(f.entered); CloseHandle(f.release);
    dispose(&f);
}
static DWORD WINAPI stress_worker(void *arg)
{
    fixture *f = arg;
    size_t i, index;
    for (i = 0; i < 512; i++) {
        void *p = push_call(&f->v, f->width, &index);
        /* Allocation bookkeeping may still grow. Protect only its inspection. */
        EnterCriticalSection(&f->cs);
        fill_slot(f, p, index);
        LeaveCriticalSection(&f->cs);
    }
    return 0;
}
static void stress(void)
{
    fixture f;
    HANDLE threads[8];
    size_t i;
    init(&f, 88); seed(&f, 8);
    for (i = 0; i < 8; i++) threads[i] = CreateThread(NULL, 0, stress_worker, &f, 0, NULL);
    if (WaitForMultipleObjects(8, threads, TRUE, 15000) != WAIT_OBJECT_0) ExitProcess(97);
    check(f.v.early_size == 4104, "eight writers preserve all unique indices");
    verify_pattern(&f, 4104);
    for (i = 0; i < 8; i++) CloseHandle(threads[i]);
    dispose(&f);
}
#define LOAD(var, name) do { FARPROC p = GetProcAddress(module, name); if (!p) { printf("FAIL missing export %s\n", name); return 80; } memcpy(&(var), &p, sizeof(var)); } while (0)
int main(void)
{
    HMODULE module = LoadLibraryA("concrt140.dll");
    int i;
    if (!module) return 79;
#ifdef _WIN64
    LOAD(reserve_call, "?_Internal_reserve@_Concurrent_vector_base_v4@details@Concurrency@@IEAAX_K00@Z");
    LOAD(push_call, "?_Internal_push_back@_Concurrent_vector_base_v4@details@Concurrency@@IEAAPEAX_KAEA_K@Z");
    LOAD(capacity_call, "?_Internal_capacity@_Concurrent_vector_base_v4@details@Concurrency@@IEBA_KXZ");
    LOAD(destroy_call, "??1_Concurrent_vector_base_v4@details@Concurrency@@IEAA@XZ");
    LOAD(grow_call, "?_Internal_grow_by@_Concurrent_vector_base_v4@details@Concurrency@@IEAA_K_K0P6AXPEAXPEBX0@Z2@Z");
    LOAD(grow_to_call, "?_Internal_grow_to_at_least_with_result@_Concurrent_vector_base_v4@details@Concurrency@@IEAA_K_K0P6AXPEAXPEBX0@Z2@Z");
    LOAD(resize_call, "?_Internal_resize@_Concurrent_vector_base_v4@details@Concurrency@@IEAAX_K00P6AXPEAX0@ZP6AX1PEBX0@Z3@Z");
    LOAD(assign_call, "?_Internal_assign@_Concurrent_vector_base_v4@details@Concurrency@@IEAAXAEBV123@_KP6AXPEAX1@ZP6AX2PEBX1@Z5@Z");
#else
    LOAD(reserve_call, "?_Internal_reserve@_Concurrent_vector_base_v4@details@Concurrency@@IAEXIII@Z");
    LOAD(push_call, "?_Internal_push_back@_Concurrent_vector_base_v4@details@Concurrency@@IAEPAXIAAI@Z");
    LOAD(capacity_call, "?_Internal_capacity@_Concurrent_vector_base_v4@details@Concurrency@@IBEIXZ");
    LOAD(destroy_call, "??1_Concurrent_vector_base_v4@details@Concurrency@@IAE@XZ");
    LOAD(grow_call, "?_Internal_grow_by@_Concurrent_vector_base_v4@details@Concurrency@@IAEIIIP6AXPAXPBXI@Z1@Z");
    LOAD(grow_to_call, "?_Internal_grow_to_at_least_with_result@_Concurrent_vector_base_v4@details@Concurrency@@IAEIIIP6AXPAXPBXI@Z1@Z");
    LOAD(resize_call, "?_Internal_resize@_Concurrent_vector_base_v4@details@Concurrency@@IAEXIIIP6AXPAXI@ZP6AX0PBXI@Z2@Z");
    LOAD(assign_call, "?_Internal_assign@_Concurrent_vector_base_v4@details@Concurrency@@IAEXABV123@IP6AXPAXI@ZP6AX1PBXI@Z4@Z");
#endif
    layout_and_callbacks(12); layout_and_callbacks(88); layout_and_callbacks(256);
    for (i = 0; i < 4; i++) { allocation_race(0); allocation_race(8); allocation_race(64); }
    stress();
    printf("CHECKS %ld FAILURES %ld\n", checks, failures);
    return failures ? 1 : 0;
}
