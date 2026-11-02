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
#include "windows.applicationmodel.h"

static LONG checks, failures;
#define CHECK(x) do { InterlockedIncrement(&checks); if (!(x)) { InterlockedIncrement(&failures); printf("FAIL package-id line=%d\n",__LINE__); } } while (0)
static const WCHAR name[]=L"Nexus.PackageProbe", publisher[]=L"CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US";
static const char manifest[]="<Package xmlns='http://schemas.microsoft.com/appx/manifest/foundation/windows10'><Identity Name='Nexus.PackageProbe' Version='1.2.3.4' ProcessorArchitecture='x64' ResourceId='en' Publisher='CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US'/><Applications><Application Id='App' Executable='probe.exe'/></Applications></Package>";

static void string_check(HRESULT hr,HSTRING str,const WCHAR *expected)
{
    UINT32 length=0;
    const WCHAR *value=WindowsGetStringRawBuffer(str,&length);
    CHECK(hr==S_OK); CHECK(length==wcslen(expected)); CHECK(!wcscmp(value,expected));
    WindowsDeleteString(str);
}
static DWORD WINAPI worker(void *context)
{
    IPackageId *id=context;
    unsigned int i;
    for(i=0;i<100;i++)
    {
        HSTRING str=NULL;
        HRESULT hr;
        IPackageId_AddRef(id);
        hr=IPackageId_get_Name(id,&str);
        string_check(hr,str,name);
        IPackageId_Release(id);
    }
    return 0;
}
static void check_current(BOOL packaged)
{
    HSTRING cls=NULL,str=NULL,retained=NULL;
    IPackageStatics *factory=NULL;
    IPackage *package=(void*)0xdeadbeef;
    IPackageId *id=NULL,*again=NULL;
    IUnknown *unknown=NULL;
    PackageVersion version;
    ProcessorArchitecture architecture;
    TrustLevel trust=FullTrust;
    IID *iids=NULL;
    ULONG count=0;
    BYTE data[4096];
    PACKAGE_ID *native=(void*)data;
    WCHAR full[512],family[512];
    UINT32 size;
    HANDLE threads[8];
    unsigned int i;
    HRESULT hr;

    CHECK(RoInitialize(RO_INIT_MULTITHREADED)==S_OK);
    CHECK(WindowsCreateString(L"Windows.ApplicationModel.Package",32,&cls)==S_OK);
    hr=RoGetActivationFactory(cls,&IID_IPackageStatics,(void**)&factory);
    WindowsDeleteString(cls);
    CHECK(hr==S_OK&&factory!=NULL);
    if(!factory)goto done;
    CHECK(IPackageStatics_get_Current(factory,NULL)==E_INVALIDARG);
    hr=IPackageStatics_get_Current(factory,&package);
    if(!packaged)
    {
        CHECK(hr==HRESULT_FROM_WIN32(APPMODEL_ERROR_NO_PACKAGE)); CHECK(package==NULL);
        if(SUCCEEDED(hr)&&package)IPackage_Release(package);
        goto factory_done;
    }
    CHECK(hr==S_OK&&package!=NULL);
    if(FAILED(hr)||!package)goto factory_done;
    CHECK(IPackage_get_Id(package,NULL)==E_INVALIDARG);
    hr=IPackage_get_Id(package,&id); CHECK(hr==S_OK&&id!=NULL);
    if(!id)goto package_done;
    CHECK(IPackage_get_Id(package,&again)==S_OK&&again==id);
    if(again)IPackageId_Release(again);
    size=sizeof(data);CHECK(GetCurrentPackageId(&size,data)==ERROR_SUCCESS);
    size=ARRAYSIZE(full);CHECK(GetCurrentPackageFullName(&size,full)==ERROR_SUCCESS);
    size=ARRAYSIZE(family);CHECK(GetCurrentPackageFamilyName(&size,family)==ERROR_SUCCESS);
    CHECK(!wcscmp(native->name,name));CHECK(!wcscmp(native->publisher,publisher));
    CHECK(!wcscmp(native->publisherId,L"8wekyb3d8bbwe"));CHECK(!wcscmp(native->resourceId,L"en"));
    CHECK(IPackageId_QueryInterface(id,&IID_IUnknown,(void**)&unknown)==S_OK&&unknown==(IUnknown*)id);
    if(unknown)IUnknown_Release(unknown);
    unknown=NULL;
    CHECK(IPackageId_QueryInterface(id,&IID_IAgileObject,(void**)&unknown)==S_OK&&unknown==(IUnknown*)id);
    if(unknown)IUnknown_Release(unknown);
    unknown=(void*)0xdeadbeef;
    CHECK(IPackageId_QueryInterface(id,&IID_IPackageIdWithMetadata,(void**)&unknown)==E_NOINTERFACE&&unknown==NULL);
    CHECK(IPackageId_QueryInterface(id,&IID_IPackageId,NULL)==E_POINTER);
    CHECK(IPackageId_GetIids(id,NULL,&iids)==E_INVALIDARG&&iids==NULL);
    CHECK(IPackageId_GetIids(id,&count,NULL)==E_INVALIDARG&&count==0);
    CHECK(IPackageId_GetIids(id,&count,&iids)==S_OK&&count==1&&iids!=NULL);
    if(iids){CHECK(IsEqualGUID(iids,&IID_IPackageId));CoTaskMemFree(iids);}
    CHECK(IPackageId_GetRuntimeClassName(id,NULL)==E_INVALIDARG);
    hr=IPackageId_GetRuntimeClassName(id,&str);string_check(hr,str,L"Windows.ApplicationModel.PackageId");
    CHECK(IPackageId_GetTrustLevel(id,NULL)==E_INVALIDARG);
    CHECK(IPackageId_GetTrustLevel(id,&trust)==S_OK&&trust==BaseTrust);
    CHECK(IPackageId_get_Name(id,NULL)==E_INVALIDARG);
    CHECK(IPackageId_get_Publisher(id,NULL)==E_INVALIDARG);
    CHECK(IPackageId_get_PublisherId(id,NULL)==E_INVALIDARG);
    CHECK(IPackageId_get_ResourceId(id,NULL)==E_INVALIDARG);
    CHECK(IPackageId_get_FullName(id,NULL)==E_INVALIDARG);
    CHECK(IPackageId_get_FamilyName(id,NULL)==E_INVALIDARG);
    CHECK(IPackageId_get_Version(id,NULL)==E_INVALIDARG);
    CHECK(IPackageId_get_Architecture(id,NULL)==E_INVALIDARG);
    hr=IPackageId_get_Name(id,&str);string_check(hr,str,native->name);
    hr=IPackageId_get_Publisher(id,&str);string_check(hr,str,native->publisher);
    hr=IPackageId_get_PublisherId(id,&str);string_check(hr,str,native->publisherId);
    hr=IPackageId_get_ResourceId(id,&str);string_check(hr,str,native->resourceId);
    hr=IPackageId_get_FullName(id,&str);string_check(hr,str,full);
    hr=IPackageId_get_FamilyName(id,&str);string_check(hr,str,family);
    CHECK(IPackageId_get_Version(id,&version)==S_OK);
    CHECK(version.Major==1&&version.Minor==2&&version.Build==3&&version.Revision==4);
    CHECK(IPackageId_get_Architecture(id,&architecture)==S_OK&&architecture==PROCESSOR_ARCHITECTURE_AMD64);
    for(i=0;i<ARRAYSIZE(threads);i++){threads[i]=CreateThread(NULL,0,worker,id,0,NULL);CHECK(threads[i]!=NULL);}
    for(i=0;i<ARRAYSIZE(threads);i++)if(threads[i]){CHECK(WaitForSingleObject(threads[i],10000)==WAIT_OBJECT_0);CloseHandle(threads[i]);}
    CHECK(IPackageId_get_Name(id,&retained)==S_OK);
    IPackageId_Release(id);
package_done:
    IPackage_Release(package);
    if(retained)string_check(S_OK,retained,name);
factory_done:
    IPackageStatics_Release(factory);
done:
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
    printf("PACKAGE_ID checks=%ld failures=%ld\n",checks,failures);return failures?1:0;
}

