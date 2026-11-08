/** Trusted runner resource policy. Candidate workflows cannot change these
 * bounds or the fixed, base64-safe transport chunk size. */
export function sourceTransferPolicy({maxSourceBundleBytes=64*1024*1024,sourceTransferConcurrency=1}={}){
 if(!Number.isSafeInteger(maxSourceBundleBytes)||maxSourceBundleBytes<1||maxSourceBundleBytes>1024*1024*1024)throw Error('maxSourceBundleBytes must be a positive integer of at most 1 GiB');
 if(!Number.isSafeInteger(sourceTransferConcurrency)||sourceTransferConcurrency<1||sourceTransferConcurrency>8)throw Error('sourceTransferConcurrency must be an integer from 1 to 8');
 return {maxSourceBundleBytes,sourceTransferConcurrency};
}
