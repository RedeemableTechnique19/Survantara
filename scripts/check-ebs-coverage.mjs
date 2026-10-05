import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../migrations/0004_warga_ebs.sql', import.meta.url), 'utf8');
const taxonomySql = readFileSync(new URL('../migrations/0007_ebs_taxonomy.sql', import.meta.url), 'utf8');
const integritySql = readFileSync(new URL('../migrations/0016_reporting_taxonomy_integrity.sql', import.meta.url), 'utf8');
const labelSql = readFileSync(new URL('../migrations/0017_ebs_catalog_labels.sql', import.meta.url), 'utf8');
const notificationSql = readFileSync(new URL('../migrations/0018_notification_triage_separation.sql', import.meta.url), 'utf8');
const catalog = JSON.parse(readFileSync(new URL('../references/skdr-ebs-catalog-2025.json', import.meta.url), 'utf8'));
const catalogEntries = Array.isArray(catalog.classifications) ? catalog.classifications : [];
const expectedNames = new Map(catalogEntries.map(entry => [String(entry.id), String(entry.name)]));
const expected = new Set(expectedNames.keys());
const expectedSuspects = new Set('220,221,226,232,227,233,231,222,228,224,230,243,196,225,244,229'.split(','));

const diseaseBlock = sql.split('INSERT OR REPLACE INTO ebs_disease_master')[1]?.split('INSERT OR REPLACE INTO ebs_mapping_rules')[0] || '';
const mappingBlock = sql.split('INSERT OR REPLACE INTO ebs_mapping_rules')[1]?.split('ALTER TABLE reports')[0] || '';
const diseases = [...diseaseBlock.matchAll(/\('([0-9]+)','/g)].map(match => match[1]);
const mapped = new Set([...mappingBlock.matchAll(/\('([0-9]+)','(?:EVENT|OBSERVATION|CONTEXT)'/g)].map(match => match[1]));
const diseaseSet = new Set(diseases);
const effectiveNames = new Map([...diseaseBlock.matchAll(/\('([0-9]+)','([^']*)',/g)].map(match => [match[1], match[2]]));
for (const match of labelSql.matchAll(/SET disease_name='([^']*)' WHERE ebs_id='([0-9]+)'/g)) effectiveNames.set(match[2], match[1]);

const missingMaster = [...expected].filter(id => !diseaseSet.has(id));
const unexpected = [...diseaseSet].filter(id => !expected.has(id));
const unmapped = [...expected].filter(id => !mapped.has(id));
const duplicates = diseases.filter((id, index) => diseases.indexOf(id) !== index);
const catalogDuplicateIds = catalogEntries.map(entry => String(entry.id)).filter((id, index, ids) => ids.indexOf(id) !== index);
const invalidCatalogEntries = catalogEntries.filter(entry => !/^\d+$/.test(String(entry.id)) || !String(entry.name || '').trim());
const labelMismatches = [...expectedNames].filter(([id, name]) => effectiveNames.get(id) !== name)
  .map(([id, expectedName]) => ({ id, expectedName, actualName: effectiveNames.get(id) }));

const idsIn = text => [...text.matchAll(/'([0-9]+)'/g)].map(match => match[1]);
const taxonomyGroupIds = [...taxonomySql.matchAll(/SET taxonomy_group='[^']+'\s+WHERE ebs_id IN \(([\s\S]*?)\);/g)]
  .flatMap(match => idsIn(match[1]));
const taxonomyMissing = [...expected].filter(id => !taxonomyGroupIds.includes(id));
const taxonomyUnexpected = taxonomyGroupIds.filter(id => !expected.has(id));
const taxonomyDuplicates = taxonomyGroupIds.filter((id, index) => taxonomyGroupIds.indexOf(id) !== index);
const suspectBlock = taxonomySql.match(/SET classification_level='SUSPECT'[\s\S]*?WHERE ebs_id IN \(([\s\S]*?)\);/)?.[1] || '';
const suspectIds = new Set(idsIn(suspectBlock));
const suspectMismatch = [...new Set([...expectedSuspects, ...suspectIds])].filter(id => expectedSuspects.has(id) !== suspectIds.has(id));
const suggestibleBlock = taxonomySql.match(/SET auto_suggestible=1[\s\S]*?WHERE ebs_id IN \(([\s\S]*?)\);/)?.[1] || '';
const suggestibleIds = new Set(idsIn(suggestibleBlock));
const thresholdBlock = taxonomySql.match(/SET suggestion_min_matches=2[\s\S]*?WHERE ebs_id IN \(([\s\S]*?)\);/)?.[1] || '';
const invalidThresholdIds = idsIn(thresholdBlock).filter(id => !suggestibleIds.has(id));
const provenanceSql = `${integritySql}\n${notificationSql}`;
const missingProvenance = ['catalog_version', 'authority', 'published_at', 'source_url', 'source_artifact_sha256', 'source_artifact_bytes']
  .filter(key => !catalog[key] || !provenanceSql.includes(String(catalog[key])));
if (!catalog.source_document_url) missingProvenance.push('source_document_url');
if (!/^[A-F0-9]{64}$/.test(String(catalog.source_artifact_sha256 || ''))) missingProvenance.push('valid source_artifact_sha256');
if (catalog.source_artifact_media_type !== 'video/mp4' || !catalog.source_artifact_captured_at) missingProvenance.push('artifact capture metadata');

if (missingMaster.length || unexpected.length || unmapped.length || duplicates.length || diseases.length !== expected.size
  || taxonomyMissing.length || taxonomyUnexpected.length || taxonomyDuplicates.length || taxonomyGroupIds.length !== expected.size
  || suspectMismatch.length || invalidThresholdIds.length || missingProvenance.length
  || catalogDuplicateIds.length || invalidCatalogEntries.length || labelMismatches.length) {
  console.error('EBS coverage check failed.', {
    missingMaster, unexpected, unmapped, duplicates, masterCount: diseases.length,
    taxonomyMissing, taxonomyUnexpected, taxonomyDuplicates, taxonomyCount: taxonomyGroupIds.length,
    suspectMismatch, invalidThresholdIds, missingProvenance,
    catalogDuplicateIds, invalidCatalogEntries, labelMismatches,
  });
  process.exit(1);
}

console.log(`EBS coverage OK: ${diseases.length} ID-label pairs match ${catalog.catalog_version}, all are mapped and taxonomy-grouped; ${suggestibleIds.size} are eligible for automatic suggestion; provenance is pinned.`);
