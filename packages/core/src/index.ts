export {
  applyContentTypeForBodyType,
  getBodyTypeForContentType,
  getContentTypeForBodyType,
} from './request/bodyTypeContentType';
export type { HeaderEntry as ContentTypeHeaderEntry } from './request/bodyTypeContentType';

export {
  HTTP_HEADERS_MAP,
  getHeaderEntry,
  getHeaderValues,
  suggestHeaders,
  type HeaderSuggestionMode,
} from './request/headersDictionary';
export type { HeaderEntry } from './request/headersDictionary';

export {
  applyPathParams,
  buildRequest,
  composeBody,
  composeCookieHeader,
  composeHeaders,
  composeUrl,
  composeUrlWithQuery,
  findPathPlaceholders,
  parseUrlQuery,
} from './request/buildRequest';
export type { AttachmentResolver, BuildRequestOptions, BuiltRequest } from './request/buildRequest';

export {
  buildAutoHeaders,
  DESKTOP_APP_ORIGIN,
  generateSpanId,
  generateTraceParent,
  mergeWithAutoHeaders,
} from './request/autoHeaders';
export type { AutoHeaderOverrides } from './request/autoHeaders';

export { isDesktop } from './request/platformDetection';

export { preSendValidation } from './request/preSendValidation';
export type {
  PreSendBlocker,
  PreSendValidationInput,
  PreSendValidationResult,
  PreSendWarning,
} from './request/preSendValidation';

export { executeRequest } from './request/executeRequest';
export type { ExecuteOptions, ExecutionResult } from './request/executeRequest';

export { requestRunToExecutionResult } from './request/requestRunAdapter';

export { applyAuth } from './request/applyAuth';
export type { AuthApplyResult, AuthApplyTarget, AuthApplyWarning } from './request/applyAuth';

export { buildDigestAuthHeader, parseDigestChallenge } from './auth/digest';
export type { BuildDigestArgs, DigestChallenge } from './auth/digest';

export {
  buildNtlmType1Negotiate,
  buildNtlmType3Authenticate,
  parseNtlmType2Challenge,
} from './auth/ntlm';
export type { BuildNtlmType3Args, NtlmType2Challenge } from './auth/ntlm';

export { buildHawkAuthHeader } from './auth/hawk';
export type { HawkSignArgs } from './auth/hawk';

export { applyAwsSigV4 } from './auth/awsSigV4';
export type { SigV4SignArgs, SigV4SignResult } from './auth/awsSigV4';

export { signJwt } from './auth/jwt';
export type { JwtAlgorithm, JwtSignArgs } from './auth/jwt';

export { computeCodeChallenge, generateCodeVerifier } from './auth/oauth2/pkce';
export type { PkceMethod } from './auth/oauth2/pkce';

export { fetchOAuth2Token, OAuth2TokenError } from './auth/oauth2/fetchToken';
export type {
  FetchOAuth2TokenArgs,
  OAuth2ErrorResponse,
  OAuth2TokenResponse,
} from './auth/oauth2/fetchToken';

export {
  buildAuthorizeUrl,
  exchangeAuthCode,
  exchangePkce,
  pollDeviceFlow,
  refreshToken,
  requestDeviceAuthorization,
  runClientCredentials,
  runRopc,
} from './auth/oauth2/grants';
export type {
  AuthCodeExchangeArgs,
  ClientCredentialsArgs,
  DeviceAuthorizationArgs,
  DeviceAuthorizationResponse,
  PkceExchangeArgs,
  PollDeviceFlowArgs,
  RefreshTokenArgs,
  RopcArgs,
} from './auth/oauth2/grants';

export { resolveInheritedAuth } from './request/resolveInheritedAuth';
export type { ResolveInheritedAuthArgs } from './request/resolveInheritedAuth';

export { parseCurl, tokenizeCurl } from './request/parseCurl';
export type { ParsedCurl } from './request/parseCurl';

export { isPostmanV2Collection, parsePostmanCollection } from './import/postmanCollection';
export type {
  ImportedFolder,
  ImportedRequest,
  ParsedPostmanCollection,
} from './import/postmanCollection';

export { isPostmanEnvironment, parsePostmanEnvironment } from './import/postmanEnvironment';
export type { ParsedPostmanEnvironment } from './import/postmanEnvironment';

export { isInsomniaExport, parseInsomniaCollection } from './import/insomniaCollection';

export { readJsonPath, runAssertions } from './assertions/runAssertions';
export type { AssertionResult } from './assertions/runAssertions';

export {
  buildScope,
  collectVariableSuggestions,
  getVariableAutocomplete,
  lookup,
  resolveString,
  resolveStringMap,
} from './environment/variableResolver';
export type {
  ResolutionScope,
  ResolveResult,
  VariableSource,
  VariableSuggestion,
} from './environment/variableResolver';

export { extractContext } from './environment/extractContext';
export type { ContextExtractionResult } from './environment/extractContext';

export {
  decryptString,
  encryptString,
  exportKey,
  generateAesKey,
  importKey,
  serializePayload,
  tryParsePayload,
} from './secrets/crypto';
export type { EncryptedPayload } from './secrets/crypto';

export { generateWorkingBranchName, slugify, validateBranchName } from './git/branchNames';
export type { BranchNameOptions } from './git/branchNames';

export { serializeWorkspaceForGit } from './git/serializeWorkspace';

export { collectAttachmentSlots } from './git/collectAttachments';
export type { AttachmentSlotRef } from './git/collectAttachments';

export { compareSemver, isValidSemver, parseSemver, sortVersionsDesc } from './release/semver';
export type { ParsedVersion } from './release/semver';

export { deprecateRelease, publishRelease, yankRelease } from './release/publishRelease';
export type { PublishReleaseArgs } from './release/publishRelease';

export {
  getLanguageFromBodyType,
  getLanguageFromContentType,
  normalizeContentType,
  supportedContentTypeLanguageMap,
} from './editors/contentTypeLanguageMap';
export type { MonacoLanguage } from './editors/contentTypeLanguageMap';

export { parseGraphqlSchema } from './editors/graphqlSchemaParser';
export type { GraphQLField, GraphQLSchemaInfo } from './editors/graphqlSchemaParser';

export { applyMerge, computeThreeWayDiff } from './git/threeWayDiff';
export type {
  ConflictResolution,
  DiffEntry,
  DiffStatus,
  EntityBucket,
  ResolutionMap,
  ThreeWayDiff,
} from './git/threeWayDiff';

export {
  EMPTY_UNPUSHED_SUMMARY,
  hasUnpushedChanges,
  summarizeUnpushedChanges,
} from './git/summarizeUnpushedChanges';
export type { UnpushedChange, UnpushedSummary } from './git/summarizeUnpushedChanges';

export { applyLinkedUpdate, previewLinkedUpdate } from './git/linkedThreeWayMerge';
export type {
  ApplyArgs as LinkedApplyArgs,
  ApplyResult as LinkedApplyResult,
  LinkedUpdateBucket,
  LinkedUpdateEntry,
  LinkedUpdatePreview,
  LinkedUpdateResolutionMap,
  LinkedUpdateStatus,
  PreviewArgs as LinkedPreviewArgs,
} from './git/linkedThreeWayMerge';

export { applyMutation } from './workspace/applyMutation';
export type { ApplyMutationOptions, ApplyMutationResult } from './workspace/applyMutation';
export type { WorkspacePatch, WorkspacePatchKind, WorkspaceState } from './workspace/patches';

export { toToon } from './transform/toon';
export { toYaml } from './transform/yaml';
export { toCsv } from './transform/csv';
export { computeTransformSavings, TRANSFORM_FORMAT_LABELS } from './transform/computeSavings';
export type {
  TransformCandidate,
  TransformFormat,
  TransformSavings,
} from './transform/computeSavings';
