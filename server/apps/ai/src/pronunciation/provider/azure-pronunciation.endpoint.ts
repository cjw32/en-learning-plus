const RECOGNITION_PATH = '/speech/recognition/conversation/cognitiveservices/v1';
const RESOURCE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Only accept Azure base endpoints; never forward keys to arbitrary URLs. */
export function resolveAzurePronunciationEndpoint(config: {
  endpoint?: string | null;
  resourceName?: string | null;
  region: string | null;
}): string | null {
  const endpoint = config.endpoint?.trim();
  if (!endpoint) {
    return config.resourceName && RESOURCE_NAME.test(config.resourceName)
      ? `https://${config.resourceName}.cognitiveservices.azure.com/stt${RECOGNITION_PATH}`
      : null;
  }
  const regional = /^https:\/\/([a-z0-9-]+)\.(?:api\.cognitive\.microsoft\.com|stt\.speech\.microsoft\.com)\/?$/.exec(endpoint);
  if (regional) {
    return regional[1] === config.region
      ? `https://${regional[1]}.stt.speech.microsoft.com${RECOGNITION_PATH}`
      : null;
  }
  const custom = /^https:\/\/([a-z0-9-]+)\.cognitiveservices\.azure\.com\/?$/.exec(endpoint);
  return custom && RESOURCE_NAME.test(custom[1])
    ? `https://${custom[1]}.cognitiveservices.azure.com/stt${RECOGNITION_PATH}`
    : null;
}
