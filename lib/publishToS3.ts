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

import {
    GitProject,
    HandlerContext,
    logger,
    Project,
    RepoRef,
} from "@atomist/automation-client";
import { doWithFiles } from "@atomist/automation-client/lib/project/util/projectUtils";
import {
    doWithProject,
    ExecuteGoal,
    ExecuteGoalResult,
    GoalInvocation,
    ProjectAwareGoalInvocation,
    slackWarningMessage,
} from "@atomist/sdm";
import {
    SlackMessage,
} from "@atomist/slack-messages";
import { Credentials, S3 } from "aws-sdk";
import * as fs from "fs-extra";
import * as mime from "mime-types";
import * as path from "path";
import { promisify } from "util";

function putObject(s3: S3, params: S3.Types.PutObjectRequest): () => Promise<S3.Types.PutObjectOutput> {
    return promisify<S3.Types.PutObjectOutput>(cb => s3.putObject(params, cb));
}

export type GlobPatterns = string[];

export interface PublishToS3Options {
    bucketName: string;
    region: string;
    filesToPublish: GlobPatterns;
    pathTranslation: (filePath: string, inv: GoalInvocation) => string;
}

export function executePublishToS3(params: PublishToS3Options): ExecuteGoal {
    return doWithProject(
        async (inv: ProjectAwareGoalInvocation): Promise<ExecuteGoalResult> => {
            if (!inv.id.sha) {
                return { code: 99, message: "SHA is not defined. I need that" };
            }
            try {
                const s3 = new S3({
                    credentials: new Credentials(inv.configuration.sdm.aws.accessKey, inv.configuration.sdm.aws.secretKey),
                });
                const result = await pushToS3(s3, inv, params);

                const linkToIndex = result.bucketUrl + inv.id.sha + "/";
                inv.progressLog.write("URL: " + linkToIndex);
                inv.progressLog.write(result.warnings.join("\n"));
                inv.progressLog.write(`${result.fileCount} files uploaded to ${linkToIndex}`);

                if (result.warnings.length > 0) {
                    await inv.addressChannels(formatWarningMessage(linkToIndex, result.warnings, inv.id, inv.context));
                }

                return {
                    code: 0,
                    externalUrls: [{ label: "Check it out!", url: linkToIndex }],
                };
            } catch (e) {
                return { code: 98, message: e.message };
            }
        }
        , { readOnly: true });
}

function formatWarningMessage(url: string, warnings: string[], id: RepoRef, ctx: HandlerContext): SlackMessage {
    return slackWarningMessage("Some files were not uploaded to S3", warnings.join("\n"), ctx, {
        author_name: `published docs from ${id.owner}/${id.repo}#${id.sha.substr(0, 7)}`,
        author_link: url,
    });
}

async function pushToS3(s3: S3, inv: ProjectAwareGoalInvocation, params: PublishToS3Options):
    Promise<{ bucketUrl: string, warnings: string[], fileCount: number }> {
    const { bucketName, filesToPublish, pathTranslation, region } = params;
    const project = inv.project;
    const warnings: string[] = [];
    let fileCount = 0;
    await doWithFiles(project, filesToPublish, async file => {
        fileCount++;
        const key = pathTranslation(file.path, inv);

        const contentType = mime.lookup(file.path);
        if (contentType === false) {
            warnings.push("Not uploading: Unable to determine content type for " + file.path);
            return;
        }

        const content = await fs.readFile(project.baseDir +
            path.sep + file.path); // replace with file.getContentBuffer when that makes it into automation-client

        logger.info(`File: ${file.path}, key: ${key}, contentType: ${contentType}`);
        await putObject(s3, {
            Bucket: bucketName,
            Key: key,
            Body: content,
            ContentType: contentType,
        })();
        logger.info("OK! Published to " + key);
    });

    return {
        bucketUrl: `http://${bucketName}.s3-website.${region}.amazonaws.com/`,
        warnings,
        fileCount,
    };
}
