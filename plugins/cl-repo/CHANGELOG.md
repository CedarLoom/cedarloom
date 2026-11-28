# Changelog

## [0.2.0](https://github.com/CedarLoom/cedarloom/compare/cedarloom-repo-v0.1.0...cedarloom-repo-v0.2.0) (2026-11-28)


### ⚠ BREAKING CHANGES

* **cl-workflow:** verify by running, guarded checks and a draft-first route ([#223](https://github.com/CedarLoom/cedarloom/issues/223))
* license under MIT ([#218](https://github.com/CedarLoom/cedarloom/issues/218))
* the coordinator reads its policy from `cedarloom.json` at the repository root (`schemaVersion` 3, with `$schema` set to `https://cedarloom.github.io/cedarloom/schema/cedarloom.json`).
* require Claude Code 2.1.330 through engines in plugin.json ([#199](https://github.com/CedarLoom/cedarloom/issues/199))
* **cl-orchestration:** remove sandbox support ([#152](https://github.com/CedarLoom/cedarloom/issues/152))
* remove retired skills and legacy paths ([#137](https://github.com/CedarLoom/cedarloom/issues/137))

### Features

* cedarloom.json replaces the policy file ([#209](https://github.com/CedarLoom/cedarloom/issues/209)) ([0fa35d5](https://github.com/CedarLoom/cedarloom/commit/0fa35d538bc3877c120b53619dbf3527e31b6890))
* **cl-orchestration:** builder, reviewer and maintain role bots ([#116](https://github.com/CedarLoom/cedarloom/issues/116)) ([07eccfd](https://github.com/CedarLoom/cedarloom/commit/07eccfd755f8f33fec95c85418e217c189698faa))
* **cl-orchestration:** one bot per development stage in setup ([#80](https://github.com/CedarLoom/cedarloom/issues/80)) ([be7311b](https://github.com/CedarLoom/cedarloom/commit/be7311b4bd060edb68a722c430cbe68678fddb98))
* **cl-orchestration:** remove sandbox support ([#152](https://github.com/CedarLoom/cedarloom/issues/152)) ([82816b8](https://github.com/CedarLoom/cedarloom/commit/82816b875168eafffed1ae827470692d7d055f1a))
* **cl-orchestration:** shared role bots for all repositories, with a host-wide run limit ([#125](https://github.com/CedarLoom/cedarloom/issues/125)) ([fd6f534](https://github.com/CedarLoom/cedarloom/commit/fd6f534daecfb81e91ed3e3a6b776b7a91834c07))
* **cl-repo:** knowledge base script ([#236](https://github.com/CedarLoom/cedarloom/issues/236)) ([1f907f0](https://github.com/CedarLoom/cedarloom/commit/1f907f0f60c92596d551a954b342875eaf3febc7))
* **cl-repo:** maintain dependency pass with grouping and changelog check ([#183](https://github.com/CedarLoom/cedarloom/issues/183)) ([7405e20](https://github.com/CedarLoom/cedarloom/commit/7405e2088a20e3f9682d9e64131f187878f2d490))
* **cl-workflow:** /cl-workflow:lite for one-sentence changes ([#113](https://github.com/CedarLoom/cedarloom/issues/113)) ([17f549c](https://github.com/CedarLoom/cedarloom/commit/17f549c7e2270e7952098e2529b9dfd5d8df242c))
* **cl-workflow:** maintainability rule for agents and reviews ([#79](https://github.com/CedarLoom/cedarloom/issues/79)) ([eb01f35](https://github.com/CedarLoom/cedarloom/commit/eb01f359aba0fabae558ed053a19afc63d6c90f1))
* **cl-workflow:** verify by running, guarded checks and a draft-first route ([#223](https://github.com/CedarLoom/cedarloom/issues/223)) ([79cc393](https://github.com/CedarLoom/cedarloom/commit/79cc3934caf449ef896236fefd37178bd8753e18))
* **debloat:** cap always-loaded instruction text separately from the total ([#46](https://github.com/CedarLoom/cedarloom/issues/46)) ([6bef4e8](https://github.com/CedarLoom/cedarloom/commit/6bef4e8c1ee722f5da6e0f9eabac2400e0a7fbef))
* remove retired skills and legacy paths ([#137](https://github.com/CedarLoom/cedarloom/issues/137)) ([2a0727c](https://github.com/CedarLoom/cedarloom/commit/2a0727c3228fcb3a6a7889c09686f5e68139e6fd))
* require Claude Code 2.1.330 through engines in plugin.json ([#199](https://github.com/CedarLoom/cedarloom/issues/199)) ([82cb662](https://github.com/CedarLoom/cedarloom/commit/82cb662f0e7f1408375fae3002dc2ad213de5c7f))
* **setup:** add a Bots step for the project bot and its role bots ([#39](https://github.com/CedarLoom/cedarloom/issues/39)) ([aa6d872](https://github.com/CedarLoom/cedarloom/commit/aa6d872bd6b4f2cc990e466e5f209914960605be))


### Bug Fixes

* **cl-repo:** check imports against the repository file list and reject a null budget ([#53](https://github.com/CedarLoom/cedarloom/issues/53)) ([17aacb0](https://github.com/CedarLoom/cedarloom/commit/17aacb095e243b6ccd7607c6dbaa1a6d3612388e))
* **cl-repo:** validate file caps and drop GIT_* variables in token-budget ([#61](https://github.com/CedarLoom/cedarloom/issues/61)) ([95b0f46](https://github.com/CedarLoom/cedarloom/commit/95b0f467819ba7725e82e2e509db2dc5d5aa7ba0))
* read classifyAllShell as a boolean, run the audit live script on macOS, clear GIT_SSH_COMMAND in the policy test ([#240](https://github.com/CedarLoom/cedarloom/issues/240)) ([0030c42](https://github.com/CedarLoom/cedarloom/commit/0030c42d34c6533b3106f799487bd9b94c00af14))
* refuse a CedarLoom label as startLabel, setup asks about never-run commands and deploys ([#242](https://github.com/CedarLoom/cedarloom/issues/242)) ([ade8a36](https://github.com/CedarLoom/cedarloom/commit/ade8a3618ae0bef714552cdd1c94ef1c19ab22d4))


### Miscellaneous Chores

* license under MIT ([#218](https://github.com/CedarLoom/cedarloom/issues/218)) ([46501fd](https://github.com/CedarLoom/cedarloom/commit/46501fd63576057b4c28aba8be7b21cb375fd14d))

## 0.1.0 (2026-11-18)


### Features

* initial commit, CedarLoom Claude Code plugins ([3f806a2](https://github.com/CedarLoom/cedarloom/commit/3f806a2e00f17e60ce81488a4a2f55ed73834220))
