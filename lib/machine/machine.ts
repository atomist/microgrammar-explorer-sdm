/*
 * Copyright © 2019 Atomist, Inc.
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

import { Project } from "@atomist/automation-client";
import {
    ExecuteGoalResult,
    goal,
    GoalProjectListenerEvent,
    GoalProjectListenerRegistration,
    goals,
    lastLinesLogInterpreter,
    onAnyPush,
    PushListenerInvocation,
    PushTest,
    SoftwareDeliveryMachine,
    SoftwareDeliveryMachineConfiguration,
    spawnLog,
    whenPushSatisfies,
} from "@atomist/sdm";
import {
    createSoftwareDeliveryMachine,
} from "@atomist/sdm-core";
import { Build } from "@atomist/sdm-pack-build";
import {
    DevelopmentEnvOptions,
    IsNode,
    nodeBuilder,
    NodeModulesProjectListener,
    npmInstallPreparation,
} from "@atomist/sdm-pack-node";
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

    const publish = goal({ displayName: "publishToS3" },
        executePublishToS3({
            bucketName: "microgrammar.atomist.com",
            region: "us-west-2",
            filesToPublish: ["static/**/*", "public/**/*", "app/index.html"],
            pathTranslation: (filepath, inv) => inv.id.sha + path.sep
                + filepath.split(path.sep).slice(1).join(path.sep),
            pathToIndex: "app/index.html",
        }),
        {
            logInterpreter: lastLinesLogInterpreter("no S3 for you", 10),
        })
        .withProjectListener(NodeModulesProjectListener)
        .withProjectListener(NpmBuildProjectListener());

    const publishGoals = goals("publish static site to S3")
        .plan(publish);

    sdm.withPushRules(
        whenPushSatisfies(requestsUploadToS3()).setGoals(publishGoals),
    );

    return sdm;
}

function requestsUploadToS3(): PushTest {
    return {
        name: "PleaseUpload",
        mapping: async (pushListenerInvocation: PushListenerInvocation): Promise<boolean> => {
            // does any file ask for publishment
            const entryPointFile = await pushListenerInvocation.project.getFile("server.ts");
            if (!entryPointFile) {
                return false;
            }
            const entryPointFileContent = await entryPointFile.getContent();
            return containsRequestForPublishment(entryPointFileContent);
        },
    };
}

export function containsRequestForPublishment(fileContent: string): boolean {
    const publishRequest = /Atomist.*[upload|publish].*to s3/mi;
    return publishRequest.test(fileContent);
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
