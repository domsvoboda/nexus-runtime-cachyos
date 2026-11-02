// SPDX-License-Identifier: MIT
#include <windows.h>
#include <ncrypt.h>
#include <bcrypt.h>
#include <stdio.h>

static unsigned int checks, failures;
#define CHECK(condition) do { ++checks; if (!(condition)) { ++failures; printf("FAIL line %u\n", (unsigned int)__LINE__); } } while (0)

static void test_curve(const WCHAR *name, ULONG bits, ULONG signature_length)
{
    BCRYPT_ALG_HANDLE algorithm = NULL;
    BCRYPT_KEY_HANDLE key = NULL;
    BYTE hash[32] = {0}, signature[132];
    ULONG length = 0;
    NTSTATUS status;

    status = BCryptOpenAlgorithmProvider(&algorithm, name, NULL, 0);
    CHECK(!status);
    if (status) return;
    status = BCryptGenerateKeyPair(algorithm, &key, bits, 0);
    CHECK(!status);
    if (status) goto done;
    status = BCryptFinalizeKeyPair(key, 0);
    CHECK(!status);
    if (status) goto done;
    status = BCryptSignHash(key, NULL, hash, sizeof(hash), NULL, 0, &length, 0);
    CHECK(!status);
    CHECK(length == signature_length);
    status = BCryptSignHash(key, NULL, hash, sizeof(hash), signature, 1, &length, 0);
    CHECK(status == (NTSTATUS)0xc0000023);
    status = BCryptSignHash(key, NULL, hash, sizeof(hash), signature, sizeof(signature), &length, 0);
    CHECK(!status);
    CHECK(length == signature_length);
    if (status) goto done;
    status = BCryptVerifySignature(key, NULL, hash, sizeof(hash), signature, length, 0);
    CHECK(!status);
    hash[0] = 1;
    status = BCryptVerifySignature(key, NULL, hash, sizeof(hash), signature, length, 0);
    CHECK(status == (NTSTATUS)0xc000a000);
done:
    if (key) CHECK(!BCryptDestroyKey(key));
    CHECK(!BCryptCloseAlgorithmProvider(algorithm, 0));
}

static void test_ncrypt(const WCHAR *name, DWORD bits, DWORD signature_length, DWORD flags)
{
    NCRYPT_PROV_HANDLE provider = 0;
    NCRYPT_KEY_HANDLE key = 0;
    BCRYPT_PKCS1_PADDING_INFO padding = {BCRYPT_SHA256_ALGORITHM};
    void *padding_info = flags ? &padding : NULL;
    BYTE hash[32] = {0}, signature[256];
    DWORD length = 0, actual_bits = 0;
    SECURITY_STATUS status;

    status = NCryptOpenStorageProvider(&provider, L"Microsoft Software Key Storage Provider", 0);
    CHECK(!status);
    if (status) return;
    /* NULL name: fresh ephemeral fixture, no credential or persistence writes. */
    status = NCryptCreatePersistedKey(provider, &key, name, NULL, 0, 0);
    CHECK(!status);
    if (status) goto done;
    status = NCryptGetProperty(key, NCRYPT_LENGTH_PROPERTY, (BYTE *)&actual_bits, sizeof(actual_bits), &length, 0);
    CHECK(!status);
    CHECK(actual_bits == bits && length == sizeof(actual_bits));
    status = NCryptFinalizeKey(key, 0);
    CHECK(!status);
    if (status) goto done;
    status = NCryptSignHash(key, padding_info, hash, sizeof(hash), NULL, 0, &length, flags);
    CHECK(!status);
    CHECK(length == signature_length);
    status = NCryptSignHash(key, padding_info, hash, sizeof(hash), signature, 1, &length, flags);
    CHECK(status == NTE_BUFFER_TOO_SMALL);
    status = NCryptSignHash(key, padding_info, hash, sizeof(hash), signature, sizeof(signature), &length, flags);
    CHECK(!status);
    CHECK(length == signature_length);
    if (status) goto done;
    status = NCryptVerifySignature(key, padding_info, hash, sizeof(hash), signature, length, flags);
    CHECK(!status);
    hash[0] = 1;
    status = NCryptVerifySignature(key, padding_info, hash, sizeof(hash), signature, length, flags);
    CHECK(status == NTE_BAD_SIGNATURE);
done:
    if (key) CHECK(!NCryptFreeObject(key));
    CHECK(!NCryptFreeObject(provider));
}

int main(void)
{
    test_ncrypt(BCRYPT_ECDSA_P256_ALGORITHM, 256, 64, 0);
    test_ncrypt(BCRYPT_RSA_ALGORITHM, 1024, 128, NCRYPT_PAD_PKCS1_FLAG);
    test_curve(BCRYPT_ECDSA_P256_ALGORITHM, 256, 64);
    test_curve(BCRYPT_ECDSA_P521_ALGORITHM, 521, 132);
    printf("CHECKS %u FAILURES %u\n", checks, failures);
    return failures ? 1 : 0;
}
