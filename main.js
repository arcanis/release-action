require(`./.pnp.js`).setup();

const {getInput} = require(`@actions/core`);
const Octokit = require(`@octokit/rest`);
const {execFileSync} = require(`child_process`);
const {readdirSync, readFileSync} = require(`fs`);
const mime = require(`mime`);
const path = require(`path`);

const artifacts = getInput(`artifacts`, {required: true});

async function main() {
    if (!process.env.GITHUB_TOKEN)
        throw new Error(`Missing GitHub token in the environment`);

    const eventData = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, `utf8`));

    const releaseId = eventData.release.id;
    const uploadUrl = eventData.release.upload_url;

    const repository = {
        owner: eventData.repository.owner.login,
        repo: eventData.repository.name,
    };

    const octokit = new Octokit({
        auth: process.env.GITHUB_TOKEN,
    });

    const allArtifacts = readdirSync(artifacts);
    const newArtifacts = new Set(allArtifacts);
    const releaseMessage = [];

    const {data: latestRelease} = await octokit.repos.getLatestRelease({
        ...repository,
    });

    if (latestRelease)
        for (const {name} of latestRelease.assets)
            newArtifacts.delete(name);

    for (const entry of allArtifacts) {
        const body = readFileSync(path.join(artifacts, entry));

        if (newArtifacts.has(entry))
            releaseMessage.push(`- New artifact: \`${entry}\``);

        console.log(entry);

        try {
            await octokit.repos.uploadReleaseAsset({
                url: uploadUrl,
                headers: {
                    [`content-length`]: body.length,
                    [`content-type`]: mime.getType(entry),
                },
                name: entry,
                file: body,
            });
        } catch (error) {
            console.log(error);
            throw error;
        }
    }

    if (latestRelease) {
        const commitOptions = octokit.repos.compareCommits.endpoint.merge({
            ...repository,
            base: latestRelease.tag_name,
            head: process.env.GITHUB_SHA,
        });

        releaseMessage.push(`## Changelog`);

        let hasCommits = false;
        for await (const {data: {commits}} of octokit.paginate.iterator(commitOptions)) {
            for (const {commit, author} of commits) {
                releaseMessage.push(`- ${commit.message}\n  \n  By **[${author.login}](${author.html_url})**`);
                hasCommits = true;
            }
        }

        if (!hasCommits) {
            releaseMessage.push(`n/a`);
        }
    }

    await octokit.repos.updateRelease({
        ...repository,
        release_id: releaseId,
        body: releaseMessage.map(line => `${line}\n`).join(`\n`),
    });
}

main().then(exitCode => {
    process.exitCode = exitCode;
}, error => {
    console.error(error.stack);
    process.exitCode = 1;
});
