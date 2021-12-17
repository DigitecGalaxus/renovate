import URL from 'url';
import { logger } from '../../../logger';
import * as packageCache from '../../../util/cache/package';
import * as allVersioning from '../../../versioning';
import type { BranchUpgradeConfig } from '../../types';
import { addReleaseNotes } from './release-notes';
import { ChangeLogRelease, ChangeLogResult } from './types';

const cacheNamespace = 'changelog-azure-release';

export async function getChangeLogJSON({
  versioning,
  currentVersion,
  newVersion,
  sourceUrl,
  sourceDirectory,
  releases,
  depName,
  manager,
}: BranchUpgradeConfig): Promise<ChangeLogResult | null> {
  const version = allVersioning.get(versioning);
  const { protocol, host, pathname } = URL.parse(sourceUrl);
  const baseUrl = `${protocol}//${host}/`;
  const repository = pathname.slice(1).replace('_git/', '');
  const apiBaseUrl = `${baseUrl}_apis/git/`;

  // This extra filter/sort should not be necessary, but better safe than sorry
  const validReleases = [...releases]
    .filter((release) => version.isVersion(release.version))
    .sort((a, b) => version.sortVersions(a.version, b.version));

  if (validReleases.length < 2) {
    logger.debug('Not enough valid releases');
    return null;
  }

  function getCacheKey(prev: string, next: string): string {
    return `${manager}:${depName}:${prev}:${next}`;
  }

  const changelogReleases: ChangeLogRelease[] = [];
  // compare versions
  const include = (v: string): boolean =>
    version.isGreaterThan(v, currentVersion) &&
    !version.isGreaterThan(v, newVersion);
  for (let i = 1; i < validReleases.length; i += 1) {
    const prev = validReleases[i - 1];
    const next = validReleases[i];
    if (include(next.version)) {
      let release = await packageCache.get(
        cacheNamespace,
        getCacheKey(prev.version, next.version)
      );
      if (!release) {
        release = {
          version: next.version,
          date: next.releaseTimestamp,
          // put empty changes so that existing templates won't break
          changes: [],
          compare: {},
        };
        const prevHead = prev.version;
        const nextHead = next.version;
        if (prevHead && nextHead) {
          release.compare.url = `${sourceUrl}/branchCompare?baseVersion=GT${prevHead}&targetVersion=GT${nextHead}`;
        }
        const cacheMinutes = 1;
        await packageCache.set(
          cacheNamespace,
          getCacheKey(prev.version, next.version),
          release,
          cacheMinutes
        );
      }
      changelogReleases.unshift(release);
    }
  }

  let res: ChangeLogResult = {
    project: {
      apiBaseUrl,
      baseUrl,
      type: 'azure',
      repository,
      sourceUrl,
      sourceDirectory,
      depName,
    },
    versions: changelogReleases,
  };

  res = await addReleaseNotes(res);

  return res;
}
