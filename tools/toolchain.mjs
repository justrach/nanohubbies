/** Trusted dispatcher configuration only. Saved images use their immutable
 * Docker config ID, because Docker save/load need not retain registry digests. */
export function archiveDownload(value) {
  const invalid=()=>Error('Use an HTTPS toolchain archive URL, exact SHA-256 and bounded byte length');
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['url','sha256','bytes'].includes(key)))throw invalid();
  if(typeof value.url!=='string'||value.url.length>8192||/[\s\x00-\x1f\x7f]/.test(value.url))throw invalid();
  if(!Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>2*1024*1024*1024)throw invalid();
  if(typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256))throw invalid();
  let url;try{url=new URL(value.url);}catch{throw invalid();}
  if(url.protocol!=='https:'||url.username||url.password||url.hash)throw invalid();
  return {url:url.href,sha256:value.sha256,bytes:value.bytes};
}
export function toolchain(image,imageSnapshot,imageArchive,imageDownload) {
  if(imageDownload!==undefined) {
    if(imageSnapshot!==undefined||imageArchive!==undefined||typeof image!=='string'||!/^sha256:[a-f0-9]{64}$/.test(image))throw Error('Archive downloads require an exact Docker image ID and cannot be combined with snapshots');
    return {image,snapshot:false,download:archiveDownload(imageDownload)};
  }
  if(imageSnapshot===undefined) {
    if(imageArchive!==undefined)throw Error('An image archive requires a trusted toolchain snapshot');
    if(typeof image!=='string'||!/^\S+@sha256:[a-f0-9]{64}$/.test(image))throw Error('Use a trusted toolchain image pinned by SHA-256 digest');
    return {image,snapshot:false};
  }
  if(typeof imageSnapshot!=='string'||!/^snp_[A-Za-z0-9_-]{1,156}$/.test(imageSnapshot)||typeof image!=='string'||!/^sha256:[a-f0-9]{64}$/.test(image))throw Error('Snapshot toolchains require an account-owned snapshot ID and exact sha256 Docker image ID');
  if(imageArchive!==undefined&&imageArchive!=='/workspace/nanohub-toolchain/image.tar')throw Error('Use the fixed trusted toolchain image archive path');
  return {image,imageSnapshot,snapshot:true,...(imageArchive?{imageArchive}:{})};
}
