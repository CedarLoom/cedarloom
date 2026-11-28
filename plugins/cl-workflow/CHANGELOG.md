# Changelog

## [0.2.0](https://github.com/CedarLoom/cedarloom/compare/cedarloom-workflow-v0.1.0...cedarloom-workflow-v0.2.0) (2026-11-28)


### ⚠ BREAKING CHANGES

* **cl-workflow:** set the model map's efforts from the effort sweep ([#231](https://github.com/CedarLoom/cedarloom/issues/231))
* **cl-workflow:** verify by running, guarded checks and a draft-first route ([#223](https://github.com/CedarLoom/cedarloom/issues/223))
* **cl-workflow:** pull request bodies and issues fill the template files ([#222](https://github.com/CedarLoom/cedarloom/issues/222))
* license under MIT ([#218](https://github.com/CedarLoom/cedarloom/issues/218))
* one model map and its resolver ([#214](https://github.com/CedarLoom/cedarloom/issues/214))
* the coordinator reads its policy from `cedarloom.json` at the repository root (`schemaVersion` 3, with `$schema` set to `https://cedarloom.github.io/cedarloom/schema/cedarloom.json`).
* require Claude Code 2.1.330 through engines in plugin.json ([#199](https://github.com/CedarLoom/cedarloom/issues/199))
* remove retired skills and legacy paths ([#137](https://github.com/CedarLoom/cedarloom/issues/137))
* **cl-workflow:** remove the optional status band ([#52](https://github.com/CedarLoom/cedarloom/issues/52))

### Features

* cedarloom.json replaces the policy file ([#209](https://github.com/CedarLoom/cedarloom/issues/209)) ([0fa35d5](https://github.com/CedarLoom/cedarloom/commit/0fa35d538bc3877c120b53619dbf3527e31b6890))
* **cl-orchestration:** builder, reviewer and maintain role bots ([#116](https://github.com/CedarLoom/cedarloom/issues/116)) ([07eccfd](https://github.com/CedarLoom/cedarloom/commit/07eccfd755f8f33fec95c85418e217c189698faa))
* **cl-orchestration:** one bot per development stage in setup ([#80](https://github.com/CedarLoom/cedarloom/issues/80)) ([be7311b](https://github.com/CedarLoom/cedarloom/commit/be7311b4bd060edb68a722c430cbe68678fddb98))
* **cl-workflow:** /cl-workflow:lite for one-sentence changes ([#113](https://github.com/CedarLoom/cedarloom/issues/113)) ([17f549c](https://github.com/CedarLoom/cedarloom/commit/17f549c7e2270e7952098e2529b9dfd5d8df242c))
* **cl-workflow:** a question count for /cl-workflow:questions ([#65](https://github.com/CedarLoom/cedarloom/issues/65)) ([e536cc0](https://github.com/CedarLoom/cedarloom/commit/e536cc050614aeec13da9c68b5316e53f70739f4))
* **cl-workflow:** ask reads a bare number as minutes ([#90](https://github.com/CedarLoom/cedarloom/issues/90)) ([57d1538](https://github.com/CedarLoom/cedarloom/commit/57d1538afe1076ee237ad033432025ade3d0255d))
* **cl-workflow:** hide the workflow skill from the slash menu ([#99](https://github.com/CedarLoom/cedarloom/issues/99)) ([071dca2](https://github.com/CedarLoom/cedarloom/commit/071dca2fb23bcad62da2938d7deab1b560238b8b))
* **cl-workflow:** maintainability rule for agents and reviews ([#79](https://github.com/CedarLoom/cedarloom/issues/79)) ([eb01f35](https://github.com/CedarLoom/cedarloom/commit/eb01f359aba0fabae558ed053a19afc63d6c90f1))
* **cl-workflow:** one away command, questions open by default ([#93](https://github.com/CedarLoom/cedarloom/issues/93)) ([f254cab](https://github.com/CedarLoom/cedarloom/commit/f254cabe152d4358b5812783c65799faf7d7cad0))
* **cl-workflow:** pull request bodies and issues fill the template files ([#222](https://github.com/CedarLoom/cedarloom/issues/222)) ([d0c7462](https://github.com/CedarLoom/cedarloom/commit/d0c74621f8ec692485e531dd9129913542b4a283))
* **cl-workflow:** remove the optional status band ([#52](https://github.com/CedarLoom/cedarloom/issues/52)) ([03debda](https://github.com/CedarLoom/cedarloom/commit/03debda850ae0462bebdde77d6c1ef5faeaa37d7))
* **cl-workflow:** role guard refuses commits that skip the commit hooks ([#184](https://github.com/CedarLoom/cedarloom/issues/184)) ([04b96b0](https://github.com/CedarLoom/cedarloom/commit/04b96b06c84db158bcb41006acbd1e6b94ccd54f))
* **cl-workflow:** set the model map's efforts from the effort sweep ([#231](https://github.com/CedarLoom/cedarloom/issues/231)) ([5130e48](https://github.com/CedarLoom/cedarloom/commit/5130e487b1cf06142137c39990929d7f0a0f8271))
* **cl-workflow:** test phase runs new and changed tests on the base commit ([#96](https://github.com/CedarLoom/cedarloom/issues/96)) ([89a26aa](https://github.com/CedarLoom/cedarloom/commit/89a26aafcabb16cc3d0e7ecbf12f2354f0e51f36))
* **cl-workflow:** verify by running, guarded checks and a draft-first route ([#223](https://github.com/CedarLoom/cedarloom/issues/223)) ([79cc393](https://github.com/CedarLoom/cedarloom/commit/79cc3934caf449ef896236fefd37178bd8753e18))
* one model map and its resolver ([#214](https://github.com/CedarLoom/cedarloom/issues/214)) ([fe12861](https://github.com/CedarLoom/cedarloom/commit/fe128615696d7cb517817be21455e76249a27f0e))
* remove retired skills and legacy paths ([#137](https://github.com/CedarLoom/cedarloom/issues/137)) ([2a0727c](https://github.com/CedarLoom/cedarloom/commit/2a0727c3228fcb3a6a7889c09686f5e68139e6fd))
* require Claude Code 2.1.330 through engines in plugin.json ([#199](https://github.com/CedarLoom/cedarloom/issues/199)) ([82cb662](https://github.com/CedarLoom/cedarloom/commit/82cb662f0e7f1408375fae3002dc2ad213de5c7f))
* **role-guard:** add roles for the project bot and the role bots ([#40](https://github.com/CedarLoom/cedarloom/issues/40)) ([496ed61](https://github.com/CedarLoom/cedarloom/commit/496ed61a1c0d26caccd86197d97e82746afe5c0f))
* **workflow:** the full workflow with its round limits as a script ([#21](https://github.com/CedarLoom/cedarloom/issues/21)) ([6405b92](https://github.com/CedarLoom/cedarloom/commit/6405b92cdc3f19cfd31b4706b028dc803816ab63))
* **workflow:** typed entries dev and research ([#19](https://github.com/CedarLoom/cedarloom/issues/19)) ([c6a3d1e](https://github.com/CedarLoom/cedarloom/commit/c6a3d1ef14390280b0daafbfc0d50fd769b65a2a))
* **workflow:** workflow definitions and their generator ([#20](https://github.com/CedarLoom/cedarloom/issues/20)) ([9da4ffa](https://github.com/CedarLoom/cedarloom/commit/9da4ffa6e765160a037a48fe626f508cb08d8aa5))


### Bug Fixes

* **cl-orchestration:** keep follow-ups and digests of public repositories local ([#55](https://github.com/CedarLoom/cedarloom/issues/55)) ([07e63f9](https://github.com/CedarLoom/cedarloom/commit/07e63f92b4518405b946feb5a0193cdd7c369c96))
* **cl-orchestration:** recognise each owner answer exactly once ([#91](https://github.com/CedarLoom/cedarloom/issues/91)) ([08bc326](https://github.com/CedarLoom/cedarloom/commit/08bc326549d5527f94a15d8fa452076dcf775a2f))
* **cl-workflow:** away off in Codex and the questions log read after the append ([#239](https://github.com/CedarLoom/cedarloom/issues/239)) ([0cf87ee](https://github.com/CedarLoom/cedarloom/commit/0cf87eee25f42da9e6df388b5ad519f795264b7f))
* **cl-workflow:** bot roles in every bot setting; unknown roles take the strictest rules ([#88](https://github.com/CedarLoom/cedarloom/issues/88)) ([77a5b33](https://github.com/CedarLoom/cedarloom/commit/77a5b33816d4aec7d10c4bf1fb4eb00ba29da208))
* **cl-workflow:** decode ANSI-C quoting before every guard check ([#97](https://github.com/CedarLoom/cedarloom/issues/97)) ([82d1a87](https://github.com/CedarLoom/cedarloom/commit/82d1a8704c1ff669dac28735738d62edd2eb60fc))
* **cl-workflow:** eval suite fixes before the first baseline ([#150](https://github.com/CedarLoom/cedarloom/issues/150)) ([d7a8d7c](https://github.com/CedarLoom/cedarloom/commit/d7a8d7cab03a115a0294861fe46ed57365ffe05f))
* **cl-workflow:** refuse answer mode in unattended sessions ([#71](https://github.com/CedarLoom/cedarloom/issues/71)) ([cd8f1fc](https://github.com/CedarLoom/cedarloom/commit/cd8f1fc531350a26dc68c898d57a1e2ac2a79693))
* **cl-workflow:** refuse builder pushes hidden by inner shells, pass grep search text ([#244](https://github.com/CedarLoom/cedarloom/issues/244)) ([1817333](https://github.com/CedarLoom/cedarloom/commit/1817333e815bb9efab69704661f51b3be77568f6))
* **cl-workflow:** role guard refuses glob refspecs and tags created in the same command ([#228](https://github.com/CedarLoom/cedarloom/issues/228)) ([5ad9275](https://github.com/CedarLoom/cedarloom/commit/5ad9275f726d02ca48e2d4d06f61313d2823c74e))
* hold unclear issues at Pick, label every answered question, state the band's Ponytail rule ([#10](https://github.com/CedarLoom/cedarloom/issues/10)) ([1813bec](https://github.com/CedarLoom/cedarloom/commit/1813bec074918f79c1f53d7e86e50dc7c24c347e))
* review rounds read one way in the workflow and the coordinator ([#18](https://github.com/CedarLoom/cedarloom/issues/18)) ([5714d2b](https://github.com/CedarLoom/cedarloom/commit/5714d2b6217e6b9464a1437e5ef8fa78b25a568a))


### Miscellaneous Chores

* license under MIT ([#218](https://github.com/CedarLoom/cedarloom/issues/218)) ([46501fd](https://github.com/CedarLoom/cedarloom/commit/46501fd63576057b4c28aba8be7b21cb375fd14d))

## 0.1.0 (2026-11-18)


### Features

* initial commit, CedarLoom Claude Code plugins ([3f806a2](https://github.com/CedarLoom/cedarloom/commit/3f806a2e00f17e60ce81488a4a2f55ed73834220))
