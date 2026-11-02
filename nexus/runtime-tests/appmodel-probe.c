#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <appmodel.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>
static LONG checks, failures;
#define CHECK(x) do { InterlockedIncrement(&checks); if (!(x)) { InterlockedIncrement(&failures); printf("FAIL appmodel line=%d\n",__LINE__); } } while(0)
typedef LONG (WINAPI *string_fn)(UINT32 *,WCHAR *);
typedef LONG (WINAPI *id_fn)(UINT32 *,BYTE *);
typedef LONG (WINAPI *info_fn)(UINT32,UINT32 *,BYTE *,UINT32 *);
static string_fn full_fn, family_fn, path_fn, app_fn;
static id_fn id_api;
static info_fn info_api;
static const WCHAR expected_full[]=L"Nexus.Package_1.2.3.4_x64__8wekyb3d8bbwe";
static const WCHAR publisher[]=L"CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US";
static const char valid_manifest[]=
 "<Package xmlns='http://schemas.microsoft.com/appx/manifest/foundation/windows10'>"
 "<Identity Name='Nexus.Package' Version='1.2.3.4' ProcessorArchitecture='x64' "
 "Publisher='CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US'/>"
 "<Applications><Application Id='App' Executable='probe.exe'/></Applications></Package>";
static BOOL write_bytes(const WCHAR *file,const void *data,DWORD size)
{
 HANDLE h=CreateFileW(file,GENERIC_WRITE,0,NULL,CREATE_ALWAYS,0,NULL);DWORD n=0;
 if(h==INVALID_HANDLE_VALUE)return FALSE;
 if(!WriteFile(h,data,size,&n,NULL))n=0;
 CloseHandle(h);return n==size;
}
static void string_contract(string_fn fn,const WCHAR *expected)
{
 WCHAR value[512];UINT32 size,required=(UINT32)wcslen(expected)+1;
 CHECK(fn(NULL,NULL)==ERROR_INVALID_PARAMETER);
 size=3;CHECK(fn(&size,NULL)==ERROR_INVALID_PARAMETER);
 size=0;SetLastError(0x1234abcd);CHECK(fn(&size,NULL)==ERROR_INSUFFICIENT_BUFFER);
 CHECK(GetLastError()==0x1234abcd);CHECK(size==required);
 memset(value,0x45,sizeof(value));size=required-1;
 CHECK(fn(&size,value)==ERROR_INSUFFICIENT_BUFFER);CHECK(size==required);CHECK(value[0]==0x4545);
 size=required;CHECK(fn(&size,value)==0);CHECK(size==required);CHECK(!wcscmp(value,expected));
 CHECK(value[required]==0x4545);
}
static DWORD WINAPI worker(void *arg)
{
 unsigned int i;(void)arg;
 for(i=0;i<200;i++){WCHAR value[200];UINT32 n=200;CHECK(full_fn(&n,value)==0);CHECK(!wcscmp(value,expected_full));}
 return 0;
}
static int child(const WCHAR *mode,const WCHAR *root)
{
 BYTE data[20000];PACKAGE_ID *id=(void*)data;PACKAGE_INFO *info=(void*)data;
 WCHAR value[512],expected_app[160],manifest[MAX_PATH];UINT32 size,count;
 HANDLE threads[8];unsigned int i;BOOL absent=!wcscmp(mode,L"none");
 HMODULE kernel=GetModuleHandleW(L"kernel32.dll");
 full_fn=(string_fn)(void*)GetProcAddress(kernel,"GetCurrentPackageFullName");
 family_fn=(string_fn)(void*)GetProcAddress(kernel,"GetCurrentPackageFamilyName");
 path_fn=(string_fn)(void*)GetProcAddress(kernel,"GetCurrentPackagePath");
 app_fn=(string_fn)(void*)GetProcAddress(kernel,"GetCurrentApplicationUserModelId");
 id_api=(id_fn)(void*)GetProcAddress(kernel,"GetCurrentPackageId");
 info_api=(info_fn)(void*)GetProcAddress(kernel,"GetCurrentPackageInfo");
 CHECK(full_fn&&family_fn&&path_fn&&app_fn&&id_api&&info_api);
 if(!full_fn||!family_fn||!path_fn||!app_fn||!id_api||!info_api)return 1;
 if(absent)
 {
  for(i=0;i<3;i++){string_fn fn=i==0?full_fn:i==1?family_fn:path_fn;size=512;memset(value,0x45,sizeof(value));CHECK(fn(&size,value)==15700);CHECK(size==512&&value[0]==0x4545);}
  size=0;CHECK(app_fn(&size,NULL)==15703);CHECK(size==0);
  size=sizeof(data);CHECK(id_api(&size,data)==15700);
  size=sizeof(data);count=99;CHECK(info_api(PACKAGE_FILTER_HEAD,&size,data,&count)==15700);
  return failures?1:0;
 }
 size=0;
 if(full_fn(&size,NULL)!=ERROR_INSUFFICIENT_BUFFER){CHECK(FALSE);return 1;}
 string_contract(full_fn,expected_full);
 string_contract(family_fn,L"Nexus.Package_8wekyb3d8bbwe");
 string_contract(path_fn,root);
 if(!wcscmp(mode,L"noapp")){size=0;CHECK(app_fn(&size,NULL)==15703);}
 else
 {
  swprintf(expected_app,160,L"Nexus.Package_8wekyb3d8bbwe!%ls",!wcscmp(mode,L"second")?L"Second":L"App");
  string_contract(app_fn,expected_app);
 }
 size=0;CHECK(id_api(&size,NULL)==ERROR_INSUFFICIENT_BUFFER);CHECK(size>sizeof(PACKAGE_ID));
 count=size;memset(data,0x45,sizeof(data));size=count-1;
 CHECK(id_api(&size,data)==ERROR_INSUFFICIENT_BUFFER);CHECK(data[0]==0x45&&size==count);
 size=count;CHECK(id_api(&size,data)==0);
 CHECK(!wcscmp(id->name,L"Nexus.Package"));CHECK(!wcscmp(id->publisher,publisher));
 CHECK(!wcscmp(id->publisherId,L"8wekyb3d8bbwe")&&!id->resourceId[0]);
 CHECK(id->processorArchitecture==PROCESSOR_ARCHITECTURE_AMD64);
 CHECK(id->version.Major==1&&id->version.Minor==2&&id->version.Build==3&&id->version.Revision==4);
 CHECK(!id->reserved);CHECK(data[count]==0x45);
 CHECK(info_api(PACKAGE_FILTER_HEAD,NULL,NULL,&count)==ERROR_INVALID_PARAMETER);
 size=0;CHECK(info_api(PACKAGE_FILTER_HEAD,&size,NULL,NULL)==ERROR_INVALID_PARAMETER);
 size=0;count=0;CHECK(info_api(PACKAGE_FILTER_HEAD,&size,NULL,&count)==ERROR_INSUFFICIENT_BUFFER);CHECK(count==1);
 count=size;memset(data,0x45,sizeof(data));size=count-1;
 CHECK(info_api(PACKAGE_FILTER_HEAD,&size,data,&i)==ERROR_INSUFFICIENT_BUFFER);CHECK(data[0]==0x45&&size==count);
 size=count;CHECK(info_api(PACKAGE_FILTER_HEAD|PACKAGE_INFORMATION_FULL,&size,data,&i)==0);CHECK(i==1);
 CHECK(!wcscmp(info->packageFullName,expected_full));CHECK(!wcscmp(info->packageFamilyName,L"Nexus.Package_8wekyb3d8bbwe"));
 CHECK(!wcsicmp(info->path,root));CHECK(!wcscmp(info->packageId.publisher,publisher));CHECK(data[size]==0x45);
 size=sizeof(data);CHECK(info_api(PACKAGE_FILTER_DIRECT,&size,data,&count)==ERROR_NOT_SUPPORTED);
 size=sizeof(data);CHECK(info_api(0x80000000,&size,data,&count)==ERROR_NOT_SUPPORTED);
 for(i=0;i<8;i++){threads[i]=CreateThread(NULL,0,worker,NULL,0,NULL);CHECK(threads[i]!=NULL);}
 for(i=0;i<8;i++)if(threads[i]){CHECK(WaitForSingleObject(threads[i],10000)==WAIT_OBJECT_0);CloseHandle(threads[i]);}
 if(!wcscmp(mode,L"cache"))
 {
  swprintf(manifest,MAX_PATH,L"%ls\\AppxManifest.xml",root);
  CHECK(write_bytes(manifest,"<bad/>",6));
  size=512;CHECK(full_fn(&size,value)==0&&!wcscmp(value,expected_full));
 }
 return failures?1:0;
}
static void join(WCHAR *out,const WCHAR *a,const WCHAR *b){swprintf(out,MAX_PATH,L"%ls\\%ls",a,b);}
static BOOL launch(const WCHAR *exe,const WCHAR *mode,const WCHAR *root,const WCHAR *cwd)
{
 STARTUPINFOW si={0};PROCESS_INFORMATION pi={0};WCHAR command[2048];DWORD code=999,waited;
 si.cb=sizeof(si);swprintf(command,2048,L"\"%ls\" --child %ls \"%ls\"",exe,mode,root);
 if(!CreateProcessW(exe,command,NULL,NULL,TRUE,0,NULL,cwd,&si,&pi))return FALSE;
 CloseHandle(pi.hThread);waited=WaitForSingleObject(pi.hProcess,20000);
 if(waited!=WAIT_OBJECT_0){TerminateProcess(pi.hProcess,99);WaitForSingleObject(pi.hProcess,2000);}
 GetExitCodeProcess(pi.hProcess,&code);CloseHandle(pi.hProcess);return waited==WAIT_OBJECT_0&&!code;
}
int wmain(int argc,WCHAR **argv)
{
 WCHAR temp[MAX_PATH],root[MAX_PATH],package[MAX_PATH],exe[MAX_PATH],self[MAX_PATH],file[MAX_PATH],nested[MAX_PATH],foreign[MAX_PATH];
 char bad[8000];WCHAR wide[8000];unsigned int i;int chars;BOOL okay;
 if(argc==4&&!wcscmp(argv[1],L"--child"))return child(argv[2],argv[3]);
 GetTempPathW(MAX_PATH,temp);CHECK(GetTempFileNameW(temp,L"npi",0,root)!=0);DeleteFileW(root);CHECK(CreateDirectoryW(root,NULL));
 GetModuleFileNameW(NULL,self,MAX_PATH);join(package,root,L"Package č spaces");CHECK(CreateDirectoryW(package,NULL));
 join(exe,package,L"probe.exe");CHECK(CopyFileW(self,exe,TRUE));join(file,package,L"AppxManifest.xml");
 CHECK(write_bytes(file,valid_manifest,sizeof(valid_manifest)-1));CHECK(launch(exe,L"valid",package,root));
 join(nested,package,L"sub");CHECK(CreateDirectoryW(nested,NULL));join(temp,nested,L"nested.exe");CHECK(CopyFileW(self,temp,TRUE));
 CHECK(launch(temp,L"valid",package,root));
 join(foreign,root,L"outside.exe");CHECK(CopyFileW(self,foreign,TRUE));
 SetEnvironmentVariableW(L"NEXUS_PACKAGE_FULL_NAME",L"Forged");
 CHECK(launch(foreign,L"none",root,package));SetEnvironmentVariableW(L"NEXUS_PACKAGE_FULL_NAME",NULL);
 /* Invalid nearest metadata must not fall through to a valid ancestor. */
 join(temp,nested,L"AppxManifest.xml");CHECK(write_bytes(temp,"<bad/>",6));join(temp,nested,L"nested.exe");CHECK(launch(temp,L"none",nested,root));
 join(temp,nested,L"AppxManifest.xml");DeleteFileW(temp);
 for(i=0;i<8;i++)
 {
  switch(i){
   case 0:snprintf(bad,sizeof(bad),"%s%s",valid_manifest,"<extra/>");break;
   case 1:snprintf(bad,sizeof(bad),"<!DOCTYPE Package SYSTEM 'http://127.0.0.1:9/external'>%s",valid_manifest);break;
   case 2:snprintf(bad,sizeof(bad),"%s",valid_manifest);memcpy(strstr(bad,"1.2.3.4"),"99999.4",7);break;
   case 3:snprintf(bad,sizeof(bad),"%s",valid_manifest);memcpy(strstr(bad,"<Identity"),"<Idontity",9);break;
   case 4:snprintf(bad,sizeof(bad),"%s",valid_manifest);memcpy(strstr(bad,"probe.exe"),"../xx.exe",9);break;
   case 5:snprintf(bad,sizeof(bad),"%s",valid_manifest);memcpy(strstr(bad,"foundation"),"wrongxxxxx",10);break;
   case 6:snprintf(bad,sizeof(bad),"%s",valid_manifest);strcpy(strstr(bad,"</Package>"),"</Wrong>");break;
   default:snprintf(bad,sizeof(bad),"<Package xmlns='http://schemas.microsoft.com/appx/manifest/foundation/windows10'><Identity Name='One' Name='Two'/></Package>");break;
  }
  CHECK(write_bytes(file,bad,(DWORD)strlen(bad)));okay=launch(exe,L"none",package,root);CHECK(okay);
 }
 CHECK(write_bytes(file,valid_manifest,sizeof(valid_manifest)-1));
 /* Both supported encodings and harmless comments must preserve identity. */
 memcpy(bad,"\xef\xbb\xbf",3);memcpy(bad+3,valid_manifest,sizeof(valid_manifest)-1);
 CHECK(write_bytes(file,bad,sizeof(valid_manifest)+2));CHECK(launch(exe,L"valid",package,root));
 wide[0]=0xfeff;chars=MultiByteToWideChar(CP_UTF8,0,valid_manifest,-1,wide+1,7999);
 CHECK(chars>0);CHECK(write_bytes(file,wide,(DWORD)(chars*sizeof(WCHAR))));CHECK(launch(exe,L"valid",package,root));
 snprintf(bad,sizeof(bad),"<!-- <Identity Name='Wrong'/> -->%s",valid_manifest);
 CHECK(write_bytes(file,bad,(DWORD)strlen(bad)));CHECK(launch(exe,L"valid",package,root));
 snprintf(bad,sizeof(bad),
 "<p:Package xmlns:p='http://schemas.microsoft.com/appx/manifest/foundation/windows10'>"
 "<p:Identity Publisher='CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US'"
 " ProcessorArchitecture='x64' Version='1.2.3.4' Name='Nexus.Package'/>"
 "<p:Applications><p:Application Executable='probe.exe' Id='App'/></p:Applications></p:Package>");
 CHECK(write_bytes(file,bad,(DWORD)strlen(bad)));CHECK(launch(exe,L"valid",package,root));
 CHECK(write_bytes(file,valid_manifest,sizeof(valid_manifest)-1));
 CHECK(launch(exe,L"cache",package,root));
 /* Every fixture path is under this newly allocated temporary directory. */
 DeleteFileW(file);DeleteFileW(exe);DeleteFileW(foreign);join(temp,nested,L"nested.exe");DeleteFileW(temp);RemoveDirectoryW(nested);RemoveDirectoryW(package);CHECK(RemoveDirectoryW(root));
 printf("CHECKS appmodel-%u checks=%ld failures=%ld\n",(unsigned int)(8*sizeof(void*)),checks,failures);
 return failures?1:0;
}
