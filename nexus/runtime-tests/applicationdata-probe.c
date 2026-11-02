// SPDX-License-Identifier: MIT
#define COBJMACROS
#define WIDL_using_Windows_ApplicationModel
#define WIDL_using_Windows_System
#include "initguid.h"
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>
#include "windef.h"
#include "winbase.h"
#include "winstring.h"
#include "roapi.h"
#include "appmodel.h"
#define WIDL_using_Windows_Foundation
#define WIDL_using_Windows_Foundation_Collections
#define WIDL_using_Windows_Storage
#include "windows.storage.h"

static LONG checks, failures;
#define CHECK(x) do { InterlockedIncrement(&checks); if (!(x)) { InterlockedIncrement(&failures); printf("FAIL appdata-cache line=%d\n",__LINE__); } } while (0)

static const char manifest[]="<Package xmlns='http://schemas.microsoft.com/appx/manifest/foundation/windows10'><Identity Name='Nexus.CacheProbe' Version='1.2.3.4' ProcessorArchitecture='x64' Publisher='CN=NexusTest'/><Applications><Application Id='App' Executable='probe.exe'/></Applications></Package>";
static void check_current(BOOL packaged)
{
    IApplicationDataStatics *factory=NULL;
    IApplicationData *data=NULL;
    IApplicationData2 *data2=NULL;
    IStorageFolder *folder=(void*)0xdeadbeef;
    IStorageItem *item=NULL;
    IUnknown *first=NULL,*second=NULL;
    IAsyncOperation_StorageFile *operation=(void*)0xdeadbeef;
    HSTRING cls=NULL,path=NULL,name=NULL;
    WCHAR family[512],expected[2048],local[1024],file[2100];
    UINT32 length;
    ULONG count;
    IID *iids=NULL;
    GUID unsupported={0x12345678,0x1234,0x1234,{1,2,3,4,5,6,7,8}};
    DateTime created;
    FileAttributes attributes;
    boolean is_folder=FALSE;
    HANDLE handle;
    DWORD written;
    HRESULT hr;
    CHECK(SUCCEEDED(RoInitialize(RO_INIT_MULTITHREADED)));
    CHECK(WindowsCreateString(L"Windows.Storage.ApplicationData",31,&cls)==S_OK);
    hr=RoGetActivationFactory(cls,&IID_IApplicationDataStatics,(void**)&factory);
    WindowsDeleteString(cls);CHECK(hr==S_OK&&factory);
    if(!factory)goto done;
    CHECK(IApplicationDataStatics_get_Current(factory,&data)==S_OK&&data);
    if(!data)goto done;
    CHECK(IApplicationData_QueryInterface(data,&IID_IApplicationData2,(void**)&data2)==S_OK&&data2);
    if(!data2)goto done;
    CHECK(IApplicationData2_get_LocalCacheFolder(data2,NULL)==E_POINTER);
    hr=IApplicationData2_get_LocalCacheFolder(data2,&folder);
    if(!packaged)
    {
        CHECK(hr==HRESULT_FROM_WIN32(APPMODEL_ERROR_NO_PACKAGE)&&folder==NULL);
        goto done;
    }
    CHECK(hr==S_OK&&folder);
    if(FAILED(hr)||!folder)goto done;
    CHECK(IStorageFolder_QueryInterface(folder,&IID_IStorageItem,(void**)&item)==S_OK&&item);
    if(!item)goto folder_done;
    CHECK(IStorageFolder_QueryInterface(folder,&IID_IUnknown,(void**)&first)==S_OK);
    CHECK(IStorageItem_QueryInterface(item,&IID_IUnknown,(void**)&second)==S_OK&&first==second);
    if(first)IUnknown_Release(first);
    if(second)IUnknown_Release(second);
    second=(void*)0xdeadbeef;
    CHECK(IStorageFolder_QueryInterface(folder,&unsupported,(void**)&second)==E_NOINTERFACE&&second==NULL);
    CHECK(IStorageItem_QueryInterface(item,&IID_IUnknown,NULL)==E_POINTER);
    CHECK(IStorageFolder_GetIids(folder,&count,&iids)==S_OK&&count==2&&iids);
    if(iids){CHECK(IsEqualGUID(iids,&IID_IStorageFolder));CHECK(IsEqualGUID(iids+1,&IID_IStorageItem));CoTaskMemFree(iids);}
    CHECK(IStorageItem_get_Path(item,NULL)==E_POINTER);
    CHECK(IStorageItem_get_Path(item,&path)==S_OK&&path);
    {
        IStorageFolder *local_folder=NULL;
        IStorageItem *local_item=NULL;
        HSTRING local_path=NULL;
        CHECK(IApplicationData_get_LocalFolder(data,&local_folder)==S_OK&&local_folder);
        CHECK(IStorageFolder_QueryInterface(local_folder,&IID_IStorageItem,(void**)&local_item)==S_OK);
        CHECK(IStorageItem_get_Path(local_item,&local_path)==S_OK);
        CHECK(wcsstr(WindowsGetStringRawBuffer(local_path,NULL),L"\\LocalState")!=NULL);
        CHECK(wcscmp(WindowsGetStringRawBuffer(local_path,NULL),WindowsGetStringRawBuffer(path,NULL))!=0);
        CHECK(RemoveDirectoryW(WindowsGetStringRawBuffer(local_path,NULL)));
        WindowsDeleteString(local_path);
        IStorageItem_Release(local_item);
        IStorageFolder_Release(local_folder);
    }
    length=ARRAYSIZE(family);CHECK(GetCurrentPackageFamilyName(&length,family)==ERROR_SUCCESS);
    CHECK(GetEnvironmentVariableW(L"LOCALAPPDATA",local,ARRAYSIZE(local))>0);
    swprintf(expected,ARRAYSIZE(expected),L"%ls\\Packages\\%ls\\LocalCache",local,family);
    CHECK(!_wcsicmp(WindowsGetStringRawBuffer(path,NULL),expected));
    CHECK(IStorageItem_get_Name(item,&name)==S_OK);
    CHECK(!wcscmp(WindowsGetStringRawBuffer(name,NULL),L"LocalCache"));WindowsDeleteString(name);
    CHECK(IStorageItem_get_Attributes(item,&attributes)==S_OK&&(attributes&FILE_ATTRIBUTE_DIRECTORY));
    CHECK(IStorageItem_get_DateCreated(item,&created)==S_OK&&created.UniversalTime>0);
    CHECK(IStorageItem_IsOfType(item,StorageItemTypes_Folder,&is_folder)==S_OK&&is_folder);
    CHECK(IStorageItem_IsOfType(item,StorageItemTypes_File,&is_folder)==S_OK&&!is_folder);
    CHECK(IStorageFolder_GetFileAsync(folder,NULL,&operation)==E_NOTIMPL&&operation==NULL);
    swprintf(file,ARRAYSIZE(file),L"%ls\\cache-probe.bin",expected);
    handle=CreateFileW(file,GENERIC_WRITE,0,NULL,CREATE_NEW,0,NULL);
    CHECK(handle!=INVALID_HANDLE_VALUE);
    if(handle!=INVALID_HANDLE_VALUE){CHECK(WriteFile(handle,"cache",5,&written,NULL)&&written==5);CloseHandle(handle);CHECK(DeleteFileW(file));}
    IApplicationData2_Release(data2);data2=NULL;
    IApplicationData_Release(data);data=NULL;
    CHECK(IStorageItem_get_Path(item,&name)==S_OK&&!wcscmp(WindowsGetStringRawBuffer(name,NULL),expected));
    WindowsDeleteString(name);WindowsDeleteString(path);
    IStorageItem_Release(item);item=NULL;
    IStorageFolder_Release(folder);folder=NULL;
    CHECK(RemoveDirectoryW(expected));
    handle=CreateFileW(expected,GENERIC_WRITE,0,NULL,CREATE_NEW,0,NULL);
    CHECK(handle!=INVALID_HANDLE_VALUE);if(handle!=INVALID_HANDLE_VALUE)CloseHandle(handle);
    CHECK(IApplicationDataStatics_get_Current(factory,&data)==S_OK);
    CHECK(IApplicationData_QueryInterface(data,&IID_IApplicationData2,(void**)&data2)==S_OK);
    hr=IApplicationData2_get_LocalCacheFolder(data2,&folder);
    CHECK(hr==HRESULT_FROM_WIN32(ERROR_DIRECTORY)&&folder==NULL);
    CHECK(DeleteFileW(expected));
    CHECK(IApplicationData2_get_LocalCacheFolder(data2,&folder)==S_OK&&folder);
    CHECK(RemoveDirectoryW(expected));
folder_done:
    if(item)IStorageItem_Release(item);
    if(folder)IStorageFolder_Release(folder);
done:
    if(data2)IApplicationData2_Release(data2);
    if(data)IApplicationData_Release(data);
    if(factory)IApplicationDataStatics_Release(factory);
    RoUninitialize();
}
static BOOL write_manifest(const WCHAR *file)
{
    HANDLE h=CreateFileW(file,GENERIC_WRITE,0,NULL,CREATE_NEW,0,NULL);
    DWORD size=0;
    if(h==INVALID_HANDLE_VALUE)return FALSE;
    if(!WriteFile(h,manifest,sizeof(manifest)-1,&size,NULL))size=0;
    CloseHandle(h);return size==sizeof(manifest)-1;
}
static void launch(const WCHAR *exe,const WCHAR *cwd,BOOL packaged)
{
    STARTUPINFOW si={0};PROCESS_INFORMATION pi={0};
    WCHAR command[2048];DWORD result=999,wait;
    BOOL started;
    si.cb=sizeof(si);
    swprintf(command,ARRAYSIZE(command),L"\"%ls\" --child %d",exe,packaged);
    started=CreateProcessW(exe,command,NULL,NULL,FALSE,0,NULL,cwd,&si,&pi);CHECK(started);
    if(!started)return;
    CloseHandle(pi.hThread);wait=WaitForSingleObject(pi.hProcess,30000);
    if(wait!=WAIT_OBJECT_0){TerminateProcess(pi.hProcess,99);WaitForSingleObject(pi.hProcess,2000);}
    CHECK(wait==WAIT_OBJECT_0);CHECK(GetExitCodeProcess(pi.hProcess,&result)&&result==0);
    CloseHandle(pi.hProcess);
}
int wmain(int argc,WCHAR **argv)
{
    WCHAR root[MAX_PATH],temp[MAX_PATH],self[MAX_PATH],exe[MAX_PATH],file[MAX_PATH],nested[MAX_PATH],outside[MAX_PATH];
    if(argc==3&&!wcscmp(argv[1],L"--child"))check_current(wcstol(argv[2],NULL,10)!=0);
    else
    {
        check_current(FALSE);
        GetTempPathW(MAX_PATH,temp);CHECK(GetTempFileNameW(temp,L"nwi",0,root)!=0);
        CHECK(DeleteFileW(root));CHECK(CreateDirectoryW(root,NULL));
        swprintf(file,MAX_PATH,L"%ls\\AppxManifest.xml",root);CHECK(write_manifest(file));
        swprintf(nested,MAX_PATH,L"%ls\\nested",root);CHECK(CreateDirectoryW(nested,NULL));
        GetModuleFileNameW(NULL,self,MAX_PATH);
        swprintf(exe,MAX_PATH,L"%ls\\probe.exe",nested);CHECK(CopyFileW(self,exe,TRUE));
        launch(exe,temp,TRUE);
        swprintf(outside,MAX_PATH,L"%ls\\outside-%lu.exe",temp,GetCurrentProcessId());CHECK(CopyFileW(self,outside,TRUE));
        launch(outside,root,FALSE);
        CHECK(DeleteFileW(outside));CHECK(DeleteFileW(exe));CHECK(RemoveDirectoryW(nested));CHECK(DeleteFileW(file));CHECK(RemoveDirectoryW(root));
    }
    printf("APPDATA_CACHE checks=%ld failures=%ld\n",checks,failures);return failures?1:0;
}
