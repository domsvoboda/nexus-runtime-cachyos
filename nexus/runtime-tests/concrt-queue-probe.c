/* SPDX-License-Identifier: MIT
 * Exercise real CONCRT exports and a caller-owned queue vtable. No game/account.
 * The same binary may be checked against a separately obtained native runtime.
 */
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

typedef struct page { struct page *next; size_t mask; unsigned char data[1]; } page;
typedef struct queue { void **vtable; void *data; size_t alloc_count, item_size; } queue;
typedef struct iterator { void *data, *value; } iterator;
typedef struct fixture {
    queue q;
    size_t allocated, freed, copied, moved, popped;
    void *pages[2048];
} fixture;
typedef struct guarded_iterator {
    uintptr_t before[2]; iterator it; uintptr_t after[2];
} guarded_iterator;
static queue *(__thiscall *queue_ctor)(queue *, size_t);
static void (__thiscall *queue_dtor)(queue *);
static void (__thiscall *queue_clear)(queue *);
static void (__thiscall *queue_push)(queue *, const void *);
static void (__thiscall *queue_move)(queue *, void *);
static BOOLEAN (__thiscall *queue_pop)(queue *, void *);
static size_t (__thiscall *queue_size)(const queue *);
static BOOLEAN (__thiscall *queue_empty)(const queue *);
static iterator *(__thiscall *iter_ctor)(iterator *, const queue *);
static void (__thiscall *iter_dtor)(iterator *);
static void (__thiscall *iter_advance)(iterator *);
static void (__thiscall *iter_assign)(iterator *, const iterator *);
static LONG checks, failures;
static void check(int ok, const char *message)
{
    ++checks;
    if (!ok && ++failures <= 30) printf("FAIL %s\n", message);
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
static void pattern(unsigned char *p, size_t width, size_t value)
{
    size_t i;
    for (i = 0; i < width; ++i) p[i] = (unsigned char)(value * 31 + i * 7 + (value >> 8));
}
static void __thiscall copy_item(queue *q, page *p, size_t index, const void *value)
{
    fixture *f = (fixture *)q;
    check(index < q->alloc_count, "copy page index in range");
    memcpy(p->data + index * q->item_size, value, q->item_size);
    ++f->copied;
}
static void __thiscall move_item(queue *q, page *p, size_t index, void *value)
{
    fixture *f = (fixture *)q;
    check(index < q->alloc_count, "move page index in range");
    memcpy(p->data + index * q->item_size, value, q->item_size);
    memset(value, 0xee, q->item_size);
    ++f->moved;
}
static void __thiscall pop_item(queue *q, void *value, page *p, size_t index)
{
    fixture *f = (fixture *)q;
    check(index < q->alloc_count, "pop page index in range");
    memcpy(value, p->data + index * q->item_size, q->item_size);
    ++f->popped;
}
static void __thiscall unused_dtor(queue *q)
{
    (void)q;
    check(0, "unexpected virtual destructor");
}
static page * __thiscall allocate_page(queue *q)
{
    fixture *f = (fixture *)q;
    page *p = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY,
            2 * sizeof(void *) + q->alloc_count * q->item_size + 16);
    if (!p || f->allocated == 2048) ExitProcess(90);
    memset(p->data + q->alloc_count * q->item_size, 0x6d, 16);
    f->pages[f->allocated++] = p;
    return p;
}
static void __thiscall deallocate_page(queue *q, page *p)
{
    fixture *f = (fixture *)q;
    size_t i;
    int found = 0;
    for (i = 0; i < f->allocated; ++i) if (f->pages[i] == p) { f->pages[i] = NULL; found = 1; break; }
    check(found, "deallocate only owned page, once");
    if (!found) return;
    for (i = 0; i < 16; ++i) if (p->data[q->alloc_count * q->item_size + i] != 0x6d) break;
    check(i == 16, "queue page boundary intact");
    HeapFree(GetProcessHeap(), 0, p);
    ++f->freed;
}
static void *vtable[] = { (void *)move_item, (void *)copy_item, (void *)pop_item,
    (void *)unused_dtor, (void *)allocate_page, (void *)deallocate_page };
static void init_queue(fixture *f, size_t width)
{
    memset(f, 0, sizeof(*f));
    check(queue_ctor(&f->q, width) == &f->q, "queue constructor returns this");
    check(f->q.item_size == width, "queue public item-size ABI");
    check(f->q.alloc_count && !(f->q.alloc_count & (f->q.alloc_count - 1)), "page allocation power of two");
    f->q.vtable = vtable;
}
static void init_iterator(guarded_iterator *g)
{
    g->before[0] = g->before[1] = (uintptr_t)0x19191919;
    g->after[0] = g->after[1] = (uintptr_t)0x72727272;
    g->it.data = g->it.value = NULL;
}
static void guards(guarded_iterator *g)
{
    check(g->before[0] == (uintptr_t)0x19191919 && g->before[1] == (uintptr_t)0x19191919
            && g->after[0] == (uintptr_t)0x72727272 && g->after[1] == (uintptr_t)0x72727272,
            "iterator has exactly two pointer-sized ABI fields");
}
static void value_at(iterator *it, size_t width, size_t index)
{
    unsigned char expected[256];
    pattern(expected, width, index);
    check(it->value != NULL, "non-end iterator points at element");
    if (it->value) check(!memcmp(it->value, expected, width), "iterator FIFO value and element byte offset");
}
static void push_range(fixture *f, size_t first, size_t last)
{
    unsigned char value[256];
    size_t i;
    for (i = first; i < last; ++i) {
        pattern(value, f->q.item_size, i);
        if (i & 1) queue_move(&f->q, value); else queue_push(&f->q, value);
    }
}
static void pop_range(fixture *f, size_t first, size_t last)
{
    unsigned char value[256], expected[256];
    size_t i;
    for (i = first; i < last; ++i) {
        pattern(expected, f->q.item_size, i);
        check(queue_pop(&f->q, value), "queued item can be popped");
        check(!memcmp(value, expected, f->q.item_size), "iteration did not mutate queue or FIFO order");
    }
}
static void finish_queue(fixture *f)
{
    check(queue_empty(&f->q) && queue_size(&f->q) == 0, "queue empty after draining");
    queue_clear(&f->q);
    check(f->allocated == f->freed, "all callback pages released after clear");
    queue_dtor(&f->q);
}
static void empty_lifecycle(void)
{
    fixture f;
    guarded_iterator a, b, end;
    void *state;
    init_queue(&f, 8);init_iterator(&a);init_iterator(&b);init_iterator(&end);
    check(iter_ctor(&a.it, &f.q) == &a.it, "iterator constructor returns this");
    check(a.it.data != NULL && a.it.value == NULL, "empty queue has owned iterator state and null value");
    state = a.it.data;
    iter_assign(&a.it, &a.it);
    check(a.it.data == state && a.it.value == NULL, "self assignment preserves empty state");
    iter_assign(&b.it, &a.it);
    check(b.it.data && b.it.data != a.it.data && !b.it.value, "empty iterator copy owns distinct state");
    iter_assign(&b.it, &end.it);
    check(!b.it.data && !b.it.value, "assignment from default end releases state");
    iter_dtor(&a.it);check(!a.it.data, "destructor clears opaque state");iter_dtor(&a.it);
    iter_dtor(&b.it);iter_dtor(&end.it);guards(&a);guards(&b);guards(&end);finish_queue(&f);
}
static void traverse(size_t width, size_t popped, size_t count)
{
    fixture f;
    guarded_iterator a, b, c, end;
    size_t i;
    void *state, *value;
    init_queue(&f, width);push_range(&f, 0, popped + count);pop_range(&f, 0, popped);
    check(!queue_empty(&f.q), "populated queue returns false with the byte-sized C++ bool ABI");
    init_iterator(&a);init_iterator(&b);init_iterator(&c);init_iterator(&end);
    check(iter_ctor(&a.it, &f.q) == &a.it, "populated iterator constructor returns this");
    value_at(&a.it, width, popped);
    state = a.it.data;value = a.it.value;iter_assign(&a.it, &a.it);
    check(a.it.data == state && a.it.value == value, "self assignment preserves iterator position");
    iter_ctor(&c.it, &f.q);iter_assign(&c.it, &a.it);
    check(c.it.data != a.it.data && c.it.value == a.it.value, "replacing owned state makes independent copy");
    for (i = 0; i < count; ++i) {
        value_at(&a.it, width, popped + i);
        if (i == count / 2) {
            iter_assign(&b.it, &a.it);
            check(b.it.data != a.it.data && b.it.value == a.it.value, "copy captures midpoint independently");
        }
        iter_advance(&a.it);
        check(queue_size(&f.q) == count, "advancing iterator is non-destructive");
    }
    check(a.it.value == NULL && a.it.data != NULL, "end reached without losing owned state");
    for (i = count / 2; i < count; ++i) { value_at(&b.it, width, popped + i);iter_advance(&b.it); }
    check(!b.it.value, "copied iterator independently reaches end");
    value_at(&c.it, width, popped);iter_dtor(&a.it);
    check(!a.it.data, "destruction releases end state");
    value_at(&c.it, width, popped);
    iter_assign(&c.it, &end.it);check(!c.it.data && !c.it.value, "default end assignment clears populated iterator");
    iter_dtor(&a.it);iter_dtor(&b.it);iter_dtor(&c.it);iter_dtor(&end.it);
    guards(&a);guards(&b);guards(&c);guards(&end);
    pop_range(&f, popped, popped + count);finish_queue(&f);
}
static void refill(void)
{
    fixture f;
    guarded_iterator a;
    size_t cycle, i, index = 0;
    init_queue(&f, 16);init_iterator(&a);
    for (cycle = 0; cycle < 40; ++cycle) {
        push_range(&f, index, index + 41);iter_ctor(&a.it, &f.q);
        for (i = 0; i < 41; ++i) { value_at(&a.it, 16, index + i);iter_advance(&a.it); }
        check(!a.it.value, "refilled queue reaches end at nonzero global index");
        iter_dtor(&a.it);pop_range(&f, index, index + 41);index += 41;
    }
    guards(&a);finish_queue(&f);
}
static void cross_queue_assignment(void)
{
    fixture f, other;
    guarded_iterator a, b;
    init_queue(&f, 16);init_queue(&other, 88);
    push_range(&f, 0, 529);push_range(&other, 0, 277);
    pop_range(&other, 0, 13);
    init_iterator(&a);init_iterator(&b);
    iter_ctor(&a.it, &f.q);iter_ctor(&b.it, &other.q);
    iter_advance(&b.it);iter_assign(&a.it, &b.it);
    check(a.it.data != b.it.data && a.it.value == b.it.value, "assignment replaces queue and width, retaining independent state");
    iter_dtor(&b.it);
    value_at(&a.it, 88, 14);iter_advance(&a.it);value_at(&a.it, 88, 15);
    iter_dtor(&a.it);guards(&a);guards(&b);
    pop_range(&f, 0, 529);pop_range(&other, 13, 277);finish_queue(&f);finish_queue(&other);
}
#ifdef _WIN64
#define SYMBOL(x64,x86) x64
#else
#define SYMBOL(x64,x86) x86
#endif
#define LOAD(fn,x64,x86) do { FARPROC proc = GetProcAddress(module, SYMBOL(x64,x86)); memcpy(&fn, &proc, sizeof(fn)); check(fn != NULL, "required export " #fn); if (!fn) return 3; } while (0)
int main(int argc, char **argv)
{
    HMODULE module;
    const size_t widths[] = {1, 2, 8, 9, 16, 17, 32, 33, 64, 65, 88, 128, 129, 256};
    size_t i, repeat;
    SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
    AddVectoredExceptionHandler(1, stub_exception);
    module = LoadLibraryA(argc > 1 ? argv[1] : "concrt140.dll");
    if (!module) { printf("FAIL LoadLibrary error %lu\n", GetLastError());return 3; }
    LOAD(queue_ctor, "??0_Concurrent_queue_base_v4@details@Concurrency@@IEAA@_K@Z", "??0_Concurrent_queue_base_v4@details@Concurrency@@IAE@I@Z");
    LOAD(queue_dtor, "??1_Concurrent_queue_base_v4@details@Concurrency@@MEAA@XZ", "??1_Concurrent_queue_base_v4@details@Concurrency@@MAE@XZ");
    LOAD(queue_clear, "?_Internal_finish_clear@_Concurrent_queue_base_v4@details@Concurrency@@IEAAXXZ", "?_Internal_finish_clear@_Concurrent_queue_base_v4@details@Concurrency@@IAEXXZ");
    LOAD(queue_push, "?_Internal_push@_Concurrent_queue_base_v4@details@Concurrency@@IEAAXPEBX@Z", "?_Internal_push@_Concurrent_queue_base_v4@details@Concurrency@@IAEXPBX@Z");
    LOAD(queue_move, "?_Internal_move_push@_Concurrent_queue_base_v4@details@Concurrency@@IEAAXPEAX@Z", "?_Internal_move_push@_Concurrent_queue_base_v4@details@Concurrency@@IAEXPAX@Z");
    LOAD(queue_pop, "?_Internal_pop_if_present@_Concurrent_queue_base_v4@details@Concurrency@@IEAA_NPEAX@Z", "?_Internal_pop_if_present@_Concurrent_queue_base_v4@details@Concurrency@@IAE_NPAX@Z");
    LOAD(queue_size, "?_Internal_size@_Concurrent_queue_base_v4@details@Concurrency@@IEBA_KXZ", "?_Internal_size@_Concurrent_queue_base_v4@details@Concurrency@@IBEIXZ");
    LOAD(queue_empty, "?_Internal_empty@_Concurrent_queue_base_v4@details@Concurrency@@IEBA_NXZ", "?_Internal_empty@_Concurrent_queue_base_v4@details@Concurrency@@IBE_NXZ");
    LOAD(iter_ctor, "??0_Concurrent_queue_iterator_base_v4@details@Concurrency@@IEAA@AEBV_Concurrent_queue_base_v4@12@@Z", "??0_Concurrent_queue_iterator_base_v4@details@Concurrency@@IAE@ABV_Concurrent_queue_base_v4@12@@Z");
    LOAD(iter_dtor, "??1_Concurrent_queue_iterator_base_v4@details@Concurrency@@IEAA@XZ", "??1_Concurrent_queue_iterator_base_v4@details@Concurrency@@IAE@XZ");
    LOAD(iter_advance, "?_Advance@_Concurrent_queue_iterator_base_v4@details@Concurrency@@IEAAXXZ", "?_Advance@_Concurrent_queue_iterator_base_v4@details@Concurrency@@IAEXXZ");
    LOAD(iter_assign, "?_Assign@_Concurrent_queue_iterator_base_v4@details@Concurrency@@IEAAXAEBV123@@Z", "?_Assign@_Concurrent_queue_iterator_base_v4@details@Concurrency@@IAEXABV123@@Z");
    empty_lifecycle();
    for (i = 0; i < sizeof(widths) / sizeof(widths[0]); ++i) {
        traverse(widths[i], 0, 529);traverse(widths[i], 13, 533);traverse(widths[i], 267, 271);
    }
    refill();
    cross_queue_assignment();
    for (repeat = 0; repeat < 500; ++repeat) empty_lifecycle();
    printf("CHECKS %ld FAILURES %ld\n", checks, failures);
    return failures ? 2 : 0;
}
