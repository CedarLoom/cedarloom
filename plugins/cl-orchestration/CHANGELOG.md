# Changelog

## [0.2.0](https://github.com/CedarLoom/cedarloom/compare/cedarloom-orchestration-v0.1.0...cedarloom-orchestration-v0.2.0) (2026-11-28)


### ⚠ BREAKING CHANGES

* **cl-orchestration:** drop the handoff file, resume and the roles page ([#263](https://github.com/CedarLoom/cedarloom/issues/263))
* **cl-orchestration:** drop coordinator context rotation ([#259](https://github.com/CedarLoom/cedarloom/issues/259))
* **cl-orchestration:** coordinate is the entry to the project bots ([#257](https://github.com/CedarLoom/cedarloom/issues/257))
* **coordinate:** guard bot state writes and host limit races, one review of record per head ([#252](https://github.com/CedarLoom/cedarloom/issues/252))
* license under MIT ([#218](https://github.com/CedarLoom/cedarloom/issues/218))
* one model map and its resolver ([#214](https://github.com/CedarLoom/cedarloom/issues/214))
* the coordinator reads its policy from `cedarloom.json` at the repository root (`schemaVersion` 3, with `$schema` set to `https://cedarloom.github.io/cedarloom/schema/cedarloom.json`).
* remove compatibility and dead code ([#212](https://github.com/CedarLoom/cedarloom/issues/212))
* require Claude Code 2.1.330 through engines in plugin.json ([#199](https://github.com/CedarLoom/cedarloom/issues/199))
* **cl-orchestration:** remove sandbox support ([#152](https://github.com/CedarLoom/cedarloom/issues/152))
* remove retired skills and legacy paths ([#137](https://github.com/CedarLoom/cedarloom/issues/137))

### Features

* cedarloom.json replaces the policy file ([#209](https://github.com/CedarLoom/cedarloom/issues/209)) ([0fa35d5](https://github.com/CedarLoom/cedarloom/commit/0fa35d538bc3877c120b53619dbf3527e31b6890))
* **cl-orchestration:** builder, reviewer and maintain role bots ([#116](https://github.com/CedarLoom/cedarloom/issues/116)) ([07eccfd](https://github.com/CedarLoom/cedarloom/commit/07eccfd755f8f33fec95c85418e217c189698faa))
* **cl-orchestration:** coordinate is the entry to the project bots ([#257](https://github.com/CedarLoom/cedarloom/issues/257)) ([57425ef](https://github.com/CedarLoom/cedarloom/commit/57425efac1a0f710564a2f814c286cd0c1a173da))
* **cl-orchestration:** drop coordinator context rotation ([#259](https://github.com/CedarLoom/cedarloom/issues/259)) ([5bb2240](https://github.com/CedarLoom/cedarloom/commit/5bb2240db01de0ee53457b431dd98254a3468475))
* **cl-orchestration:** drop the handoff file, resume and the roles page ([#263](https://github.com/CedarLoom/cedarloom/issues/263)) ([2818c8c](https://github.com/CedarLoom/cedarloom/commit/2818c8cb0316f15d1418dff774f104552236dab4))
* **cl-orchestration:** one bot per development stage in setup ([#80](https://github.com/CedarLoom/cedarloom/issues/80)) ([be7311b](https://github.com/CedarLoom/cedarloom/commit/be7311b4bd060edb68a722c430cbe68678fddb98))
* **cl-orchestration:** pickup orders ready issues by the Priority field ([#114](https://github.com/CedarLoom/cedarloom/issues/114)) ([45ee1d7](https://github.com/CedarLoom/cedarloom/commit/45ee1d7d95e3750a45ebc5a38d8b1adfbfd966fe))
* **cl-orchestration:** remove sandbox support ([#152](https://github.com/CedarLoom/cedarloom/issues/152)) ([82816b8](https://github.com/CedarLoom/cedarloom/commit/82816b875168eafffed1ae827470692d7d055f1a))
* **cl-orchestration:** render worker specs with spec.mjs ([#262](https://github.com/CedarLoom/cedarloom/issues/262)) ([790ee5f](https://github.com/CedarLoom/cedarloom/commit/790ee5f72f3b966632f1545de7516517c404af2d))
* **cl-orchestration:** shared role bots for all repositories, with a host-wide run limit ([#125](https://github.com/CedarLoom/cedarloom/issues/125)) ([fd6f534](https://github.com/CedarLoom/cedarloom/commit/fd6f534daecfb81e91ed3e3a6b776b7a91834c07))
* **cl-workflow:** one away command, questions open by default ([#93](https://github.com/CedarLoom/cedarloom/issues/93)) ([f254cab](https://github.com/CedarLoom/cedarloom/commit/f254cabe152d4358b5812783c65799faf7d7cad0))
* **coordinate:** add merge.mjs, the single merge entry point for bots ([#29](https://github.com/CedarLoom/cedarloom/issues/29)) ([84b351f](https://github.com/CedarLoom/cedarloom/commit/84b351fb9502d6ec2a2e289dcfff9ae11d45c954))
* **coordinate:** add the bot brief and per-automation procedures ([#36](https://github.com/CedarLoom/cedarloom/issues/36)) ([d3f9d88](https://github.com/CedarLoom/cedarloom/commit/d3f9d886fa10ea5f1aceee1f164ab119c46035e0))
* **coordinate:** add the catch-up precheck and daily run limits ([#33](https://github.com/CedarLoom/cedarloom/issues/33)) ([cd4640a](https://github.com/CedarLoom/cedarloom/commit/cd4640a79f5f4e4e2849b6bada4a8bf37e1ef54c))
* **coordinate:** branch deletion and start checks as scripts ([#73](https://github.com/CedarLoom/cedarloom/issues/73)) ([c8c7009](https://github.com/CedarLoom/cedarloom/commit/c8c7009508d16b46c9b209c410f480bc93a3b2c0))
* **coordinate:** guard refuses bypass flags, clone checkouts and direct merges ([#247](https://github.com/CedarLoom/cedarloom/issues/247)) ([55d0dca](https://github.com/CedarLoom/cedarloom/commit/55d0dca326482843152bb327b4564c07a6ad11b8))
* **coordinate:** script the commit-and-push checks and the reconciliation ([#28](https://github.com/CedarLoom/cedarloom/issues/28)) ([d156adf](https://github.com/CedarLoom/cedarloom/commit/d156adf69cfbda692b7ce7f3ef5a68dc14c81ae6))
* one model map and its resolver ([#214](https://github.com/CedarLoom/cedarloom/issues/214)) ([fe12861](https://github.com/CedarLoom/cedarloom/commit/fe128615696d7cb517817be21455e76249a27f0e))
* remove compatibility and dead code ([#212](https://github.com/CedarLoom/cedarloom/issues/212)) ([c6f2c72](https://github.com/CedarLoom/cedarloom/commit/c6f2c72526bc8e364aaff2288fbfc854d95de6d2))
* remove retired skills and legacy paths ([#137](https://github.com/CedarLoom/cedarloom/issues/137)) ([2a0727c](https://github.com/CedarLoom/cedarloom/commit/2a0727c3228fcb3a6a7889c09686f5e68139e6fd))
* require Claude Code 2.1.330 through engines in plugin.json ([#199](https://github.com/CedarLoom/cedarloom/issues/199)) ([82cb662](https://github.com/CedarLoom/cedarloom/commit/82cb662f0e7f1408375fae3002dc2ad213de5c7f))
* **setup:** add a Bots step for the project bot and its role bots ([#39](https://github.com/CedarLoom/cedarloom/issues/39)) ([aa6d872](https://github.com/CedarLoom/cedarloom/commit/aa6d872bd6b4f2cc990e466e5f209914960605be))


### Bug Fixes

* **cl-orchestration:** a finished planner or worker result starts the pick sweep ([#86](https://github.com/CedarLoom/cedarloom/issues/86)) ([58278d6](https://github.com/CedarLoom/cedarloom/commit/58278d6312b94aa35a6668da14deee71ca0d6647))
* **cl-orchestration:** an Orca model or background wait is a notice, not a stop ([#196](https://github.com/CedarLoom/cedarloom/issues/196)) ([36a0aba](https://github.com/CedarLoom/cedarloom/commit/36a0aba103be554b3def383ef29e8acbb85198d3))
* **cl-orchestration:** approval edge cases and the project's start label ([#260](https://github.com/CedarLoom/cedarloom/issues/260)) ([81c1888](https://github.com/CedarLoom/cedarloom/commit/81c18889458dcd181efabc27a9a395cee970d639))
* **cl-orchestration:** close host limit and follow-up counting gaps ([#148](https://github.com/CedarLoom/cedarloom/issues/148)) ([23995ab](https://github.com/CedarLoom/cedarloom/commit/23995abb3b89eede031bb7f1b71f62d26634451a))
* **cl-orchestration:** host limit lock that never frees a held slot ([#149](https://github.com/CedarLoom/cedarloom/issues/149)) ([6af917c](https://github.com/CedarLoom/cedarloom/commit/6af917c5de9301fc7b4250d5341de21ed3c3b4ff))
* **cl-orchestration:** keep follow-ups and digests of public repositories local ([#55](https://github.com/CedarLoom/cedarloom/issues/55)) ([07e63f9](https://github.com/CedarLoom/cedarloom/commit/07e63f92b4518405b946feb5a0193cdd7c369c96))
* **cl-orchestration:** keep the question queue local and fail closed on cut lists ([#229](https://github.com/CedarLoom/cedarloom/issues/229)) ([caee134](https://github.com/CedarLoom/cedarloom/commit/caee134bf8b78a0d40accd9310e8e75da4b4cb7a))
* **cl-orchestration:** key every owner answer a pull request run takes ([#241](https://github.com/CedarLoom/cedarloom/issues/241)) ([23c2b54](https://github.com/CedarLoom/cedarloom/commit/23c2b54d03735f7cdbe4d42cdb0ea3fc7b0357d9))
* **cl-orchestration:** merge.mjs requires the policy's required checks green on the head ([#230](https://github.com/CedarLoom/cedarloom/issues/230)) ([e4c348a](https://github.com/CedarLoom/cedarloom/commit/e4c348afa11edc4d47c834f55f77761cab06ee15))
* **cl-orchestration:** project bot starts no fix run for a cancelled or awaiting check ([#198](https://github.com/CedarLoom/cedarloom/issues/198)) ([14e98d8](https://github.com/CedarLoom/cedarloom/commit/14e98d897e3a13f47a25c94faabaf13d7de1f59d))
* **cl-orchestration:** recognise each owner answer exactly once ([#91](https://github.com/CedarLoom/cedarloom/issues/91)) ([08bc326](https://github.com/CedarLoom/cedarloom/commit/08bc326549d5527f94a15d8fa452076dcf775a2f))
* **cl-orchestration:** rotation restore skips a subagent's compaction ([#197](https://github.com/CedarLoom/cedarloom/issues/197)) ([9ee7075](https://github.com/CedarLoom/cedarloom/commit/9ee7075b7e38f71b000efe7710a60f07a37222d9))
* **cl-orchestration:** setup-bots asks about isolation every time, counts a planned policy and guards results/ ([#249](https://github.com/CedarLoom/cedarloom/issues/249)) ([fbab073](https://github.com/CedarLoom/cedarloom/commit/fbab073acceddfdc8b12d29da6bd4a8556e3597f))
* **cl-workflow:** bot roles in every bot setting; unknown roles take the strictest rules ([#88](https://github.com/CedarLoom/cedarloom/issues/88)) ([77a5b33](https://github.com/CedarLoom/cedarloom/commit/77a5b33816d4aec7d10c4bf1fb4eb00ba29da208))
* **cl-workflow:** decode ANSI-C quoting before every guard check ([#97](https://github.com/CedarLoom/cedarloom/issues/97)) ([82d1a87](https://github.com/CedarLoom/cedarloom/commit/82d1a8704c1ff669dac28735738d62edd2eb60fc))
* **cl-workflow:** refuse answer mode in unattended sessions ([#71](https://github.com/CedarLoom/cedarloom/issues/71)) ([cd8f1fc](https://github.com/CedarLoom/cedarloom/commit/cd8f1fc531350a26dc68c898d57a1e2ac2a79693))
* **cl-workflow:** refuse builder pushes hidden by inner shells, pass grep search text ([#244](https://github.com/CedarLoom/cedarloom/issues/244)) ([1817333](https://github.com/CedarLoom/cedarloom/commit/1817333e815bb9efab69704661f51b3be77568f6))
* **coordinate:** catch-up red set, fix-handled green heads, input checks ([#250](https://github.com/CedarLoom/cedarloom/issues/250)) ([4fa5226](https://github.com/CedarLoom/cedarloom/commit/4fa5226e64d267b867e97581ed125a1daf94badf))
* **coordinate:** guard bot state writes and host limit races, one review of record per head ([#252](https://github.com/CedarLoom/cedarloom/issues/252)) ([52b1b73](https://github.com/CedarLoom/cedarloom/commit/52b1b73c46b6cb81ec90e84d3a374c4f9bbfbe2d))
* hold unclear issues at Pick, label every answered question, state the band's Ponytail rule ([#10](https://github.com/CedarLoom/cedarloom/issues/10)) ([1813bec](https://github.com/CedarLoom/cedarloom/commit/1813bec074918f79c1f53d7e86e50dc7c24c347e))
* read classifyAllShell as a boolean, run the audit live script on macOS, clear GIT_SSH_COMMAND in the policy test ([#240](https://github.com/CedarLoom/cedarloom/issues/240)) ([0030c42](https://github.com/CedarLoom/cedarloom/commit/0030c42d34c6533b3106f799487bd9b94c00af14))
* refuse a CedarLoom label as startLabel, setup asks about never-run commands and deploys ([#242](https://github.com/CedarLoom/cedarloom/issues/242)) ([ade8a36](https://github.com/CedarLoom/cedarloom/commit/ade8a3618ae0bef714552cdd1c94ef1c19ab22d4))
* resolve the token budget path warnings ([#224](https://github.com/CedarLoom/cedarloom/issues/224)) ([e101360](https://github.com/CedarLoom/cedarloom/commit/e101360ccbf2fdaa173b3212e22da5bb933b57d7))
* review rounds read one way in the workflow and the coordinator ([#18](https://github.com/CedarLoom/cedarloom/issues/18)) ([5714d2b](https://github.com/CedarLoom/cedarloom/commit/5714d2b6217e6b9464a1437e5ef8fa78b25a568a))


### Miscellaneous Chores

* license under MIT ([#218](https://github.com/CedarLoom/cedarloom/issues/218)) ([46501fd](https://github.com/CedarLoom/cedarloom/commit/46501fd63576057b4c28aba8be7b21cb375fd14d))

## 0.1.0 (2026-11-18)


### Features

* initial commit, CedarLoom Claude Code plugins ([3f806a2](https://github.com/CedarLoom/cedarloom/commit/3f806a2e00f17e60ce81488a4a2f55ed73834220))
