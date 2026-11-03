// SPDX-License-Identifier: MIT
import path from 'node:path';
export function sourceArchiveArgs(archive,source,auxiliary,prepared,mediaVersion,xml2Source=false,portableGlib=false) {
  if([archive,source,auxiliary,prepared].some(p=>!path.isAbsolute(p))||!/^\d+\.\d+\.\d+$/.test(mediaVersion))throw Error('Exact source archive inputs required');
  return ['--exclude=.git','--exclude=./contrib','--transform=s,^\\./,source/,','-cJf',archive,'-C',source,'.','-C',auxiliary,'nghttp2-src','auxiliary.json','media/ffmpeg-'+mediaVersion+'.tar.xz','media/media-manifest.json',...(portableGlib?['portable-glib/manifest.json','portable-glib/COPYING','portable-glib/glib-2.84.4.tar.xz','portable-libva/manifest.json','portable-libva/COPYING','portable-libva/libva-2.22.0.tar.bz2']:[]),'-C',prepared,'prepared.json','source-module-plan.json','runtime-dependency-sources',...(xml2Source?['xgr-xml2-source','xgr-xml2-source.json']:[])];
}
