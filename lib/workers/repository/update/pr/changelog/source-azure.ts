import URL from 'url';
import { logger } from '../../../../../logger';
import * as allVersioning from '../../../../../modules/versioning';
import * as packageCache from '../../../../../util/cache/package';
import type { BranchUpgradeConfig } from '../../../../types';
import { slugifyUrl } from './common';
import { addReleaseNotes } from './release-notes';
import { getInRangeReleases } from './releases';
import type { ChangeLogRelease, ChangeLogResult } from './types';

const cacheNamespace = 'changelog-azure-release';

export async function getChangeLogJSON(
  config: BranchUpgradeConfig
): Promise<ChangeLogResult | null> {
  const currentVersion = config.currentVersion!;
  const newVersion = config.newVersion!;
  const sourceUrl = config.sourceUrl!;
  const packageName = config.packageName!;
  const sourceDirectory = config.sourceDirectory!;

  logger.trace('getChangeLogJSON for azure');
  const version = allVersioning.get(config.versioning);

  const parsedUrl = URL.parse(sourceUrl);
  const protocol = parsedUrl.protocol!;
  const host = parsedUrl.host!;
  const pathname = parsedUrl.pathname!;

  logger.trace({ protocol, host, pathname }, 'Protocol, host, pathname');
  const baseUrl = `${protocol}//${host}/`;
  const repository = pathname.slice(1).replace('_git/', '');
  const apiBaseUrl = `${baseUrl}_apis/git/`;

  const releases = config.releases ?? (await getInRangeReleases(config));
  if (!releases?.length) {
    logger.debug('No releases');
    return null;
  }
  const tagPrefix = releases.filter((r) => r.tagPrefix !== '')[0]?.tagPrefix;

  // This extra filter/sort should not be necessary, but better safe than sorry
  const validReleases = [...releases]
    .filter((release) => version.isVersion(release.version))
    .sort((a, b) => version.sortVersions(a.version, b.version));

  if (validReleases.length < 2) {
    logger.debug('Not enough valid releases');
    return null;
  }

  function getCacheKey(prev: string, next: string): string {
    return `${slugifyUrl(sourceUrl)}:${packageName}:${prev}:${next}`;
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
          tagPrefix,
          version: next.version,
          date: next.releaseTimestamp,
          // put empty changes so that existing templates won't break
          changes: [],
          compare: {},
        };
        if (prev.tagPrefix) {
          release.compare.url = `${sourceUrl}/branchCompare?baseVersion=GT${
            prev.tagPrefix
          }%2F${prev.version}&targetVersion=GT${next.tagPrefix!}%2F${
            next.version
          }`;
        } else {
          release.compare.url = `${sourceUrl}/branchCompare?baseVersion=GT${prev.version}&targetVersion=GT${next.version}`;
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

  let res: ChangeLogResult | null;

  res = {
    project: {
      apiBaseUrl,
      baseUrl,
      type: 'azure',
      repository,
      sourceUrl,
      sourceDirectory,
      packageName,
      tagPrefix,
    },
    versions: changelogReleases,
  };

  res = await addReleaseNotes(res, config);

  return res;
}
