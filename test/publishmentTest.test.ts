import * as assert from "assert";
import { containsRequestForPublishment } from "../lib/machine/machine";

describe("should we publish this project", () => {
    it("notices the comment and says yes", async () => {
        const content = `
/**
 * This project is completely static.
 * This server.ts is handy for serving the files locally, but really, we can serve it from wherever.
 * Atomist, please upload this to s3
 */`;
        assert(containsRequestForPublishment(content));
    });

    it("says no when the words are scattered", async () => {

        const content = `L al la la I like Atomist
        I also want to do an upload
        and someday I will look at S3`;
        assert(!containsRequestForPublishment(content));
    });
});
