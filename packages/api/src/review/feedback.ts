import type {Review} from './types';

/** Display the opinion separately from the legacy, authority-bearing verdict. */
export const reviewDecision=(review:Pick<Review,'verdict'|'feedback'>)=>review.feedback?.verdict??review.verdict;
export const isHumanReview=(review:Pick<Review,'independent'|'feedback'>)=>review.independent===true||review.feedback?.role==='reader';
