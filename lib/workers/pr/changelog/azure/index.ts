import * as azureApi from '../../../../platform/azure/azure-got-wrapper';
import isChangelogPath from 'is-changelog-path';
import { logger } from '../../../../logger';
import { ensureTrailingSlash } from '../../../../util/url';
import type { ChangeLogFile, ChangeLogNotes } from '../types';
import {
  GitObjectType,
  GitTreeEntryRef,
} from 'azure-devops-node-api/interfaces/GitInterfaces';

function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks = [];
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', (err) => reject(err));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

export async function getReleaseNotesMd(
  repository: string,
  apiBaseUrl: string,
  sourceDirectory: string
): Promise<ChangeLogFile> | null {
  logger.trace('azure.getReleaseNotesMd()');

  let gitApi = await azureApi.gitApi();
  var repoInfo = repository.split('/');
  const repoName = repoInfo.pop();
  const projectName = repoInfo.pop();

  const { objectId: rootObjectId } = await gitApi.getItem(
    repoName,
    sourceDirectory ? sourceDirectory : '/',
    projectName
  );

  const res = await gitApi.getTree(
    repoName,
    rootObjectId,
    projectName,
    null,
    true
  );

  const allFiles = res.treeEntries.filter(
    (f) => f.gitObjectType === GitObjectType.Blob
  );
  let files: GitTreeEntryRef[] = [];
  if (sourceDirectory?.length) {
    files = allFiles
      .filter((f) => f.relativePath.startsWith(sourceDirectory))
      .filter((f) =>
        isChangelogPath(
          f.relativePath.replace(ensureTrailingSlash(sourceDirectory), '')
        )
      );
  }
  if (!files.length) {
    files = allFiles.filter((f) => isChangelogPath(f.relativePath));
  }
  if (!files.length) {
    logger.trace('no changelog file found');
    return null;
  }
  const { relativePath: changelogFile, objectId } = files.shift();
  /* istanbul ignore if */
  if (files.length !== 0) {
    logger.debug(
      `Multiple candidates for changelog file, using ${changelogFile}`
    );
  }

  let contentRes = await gitApi.getBlobContent(repoName, objectId, projectName);
  const changelogMd = await streamToString(contentRes);

  return { changelogFile, changelogMd };
}

export async function getReleaseList(
  apiBaseUrl: string,
  repository: string
): Promise<ChangeLogNotes[]> {
  logger.trace('github.getReleaseList()');
  logger.debug('Azure Devops does not have releases');
  return [];
}
