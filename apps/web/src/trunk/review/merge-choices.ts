import type {MergeMethod} from '@swarm/api/review';
export const mergeChoices:Record<MergeMethod,{name:string;description:string;button:string}>={
 'fast-forward':{name:'Fast-forward',description:'Move the target to the reviewed head without creating a commit.',button:'Merge pull request'},
 merge:{name:'Merge commit',description:'Keep the feature history and add a merge commit.',button:'Merge pull request'},
 squash:{name:'Squash and merge',description:'Combine the changes into one new commit.',button:'Squash and merge'},
 rebase:{name:'Rebase and merge',description:'Rewrite a linear feature history as new commits on the target.',button:'Rebase and merge'},
};
export const mergeChoiceOrder:MergeMethod[]=['fast-forward','merge','squash','rebase'];
