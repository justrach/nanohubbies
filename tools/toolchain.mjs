/** Trusted dispatcher configuration only. Snapshot images use their immutable
 * Docker config ID, because Docker save/load need not retain registry digests. */
export function toolchain(image,imageSnapshot,imageArchive) {
  if(imageSnapshot===undefined) {
    if(imageArchive!==undefined)throw Error('An image archive requires a trusted toolchain snapshot');
    if(typeof image!=='string'||!/^\S+@sha256:[a-f0-9]{64}$/.test(image))throw Error('Use a trusted toolchain image pinned by SHA-256 digest');
    return {image,snapshot:false};
  }
  if(typeof imageSnapshot!=='string'||!/^snp_[A-Za-z0-9_-]{1,156}$/.test(imageSnapshot)||typeof image!=='string'||!/^sha256:[a-f0-9]{64}$/.test(image))throw Error('Snapshot toolchains require an account-owned snapshot ID and exact sha256 Docker image ID');
  if(imageArchive!==undefined&&imageArchive!=='/workspace/nanohub-toolchain/image.tar')throw Error('Use the fixed trusted toolchain image archive path');
  return {image,imageSnapshot,snapshot:true,...(imageArchive?{imageArchive}:{})};
}
