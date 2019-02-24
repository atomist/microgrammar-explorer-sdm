/*
 * Copyright © 2018 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
    ExecuteGoalResult,
    goal,
    GoalProjectListenerEvent,
    GoalProjectListenerRegistration,
    goals,
    lastLinesLogInterpreter,
    onAnyPush,
    SoftwareDeliveryMachine,
    SoftwareDeliveryMachineConfiguration,
    spawnLog,
} from "@atomist/sdm";
import {
    createSoftwareDeliveryMachine,
} from "@atomist/sdm-core";
import { Build } from "@atomist/sdm-pack-build";
import { DevelopmentEnvOptions, IsNode, nodeBuilder, NodeModulesProjectListener, npmInstallPreparation } from "@atomist/sdm-pack-node";
import * as path from "path";
import { executePublishToS3 } from "../publishToS3";

/**
 * Initialize an sdm definition, and add functionality to it.
 *
 * @param configuration All the configuration for this service
 */
export function machine(
    configuration: SoftwareDeliveryMachineConfiguration,
): SoftwareDeliveryMachine {

    const sdm = createSoftwareDeliveryMachine({
        name: "Empty Seed Software Delivery Machine",
        configuration,
    });

    /*
     * this is a good place to type
    sdm.
     * and see what the IDE suggests for after the dot
     */

    const build = new Build().with({
        name: "npm",
        builder: nodeBuilder({ command: "npm", args: ["run", "build"] }),
    }).withProjectListener(NodeModulesProjectListener);

    const publish = goal({ displayName: "publishToS3" },
        executePublishToS3({
            bucketName: "microgrammar-explorer.atomist.com",
            region: "us-west-2",
            filesToPublish: ["static/**/*", "public/**/*", "app/index.html"],
            pathTranslation: (filepath, inv) => inv.id.sha + path.sep
                + filepath.split(path.sep).slice(1).join(path.sep),
        }),
        { logInterpreter: lastLinesLogInterpreter("no S3 for you", 10) })
        .withProjectListener(NodeModulesProjectListener)
        .withProjectListener(NpmBuildProjectListener());

    const publishGoals = goals("buildinate")
        .plan(build)
        .plan(publish).after(build);

    sdm.withPushRules(
        onAnyPush().setGoals(publishGoals),
    );

    return sdm;
}

export function NpmBuildProjectListener(): GoalProjectListenerRegistration {
    return {
        name: "npm build",
        pushTest: IsNode,
        listener: async (p, goalInvocation): Promise<void | ExecuteGoalResult> => {
            return spawnLog(
                "npm",
                ["run", "build"],
                {
                    cwd: p.baseDir,
                    ...DevelopmentEnvOptions,
                    log: goalInvocation.progressLog,
                });
        },
        events: [GoalProjectListenerEvent.before],
    };
}
