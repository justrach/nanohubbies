import type {MergeMethod} from '../review/merge-types';
export interface MergeSettingsInput {allowedMethods:MergeMethod[];defaultMethod:MergeMethod}
export interface MergeSettings extends MergeSettingsInput {revision:number}
