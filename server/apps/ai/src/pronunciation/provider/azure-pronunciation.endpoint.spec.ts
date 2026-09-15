import { resolveAzurePronunciationEndpoint } from './azure-pronunciation.endpoint';

describe('Azure pronunciation endpoint configuration', () => {
  it.each([
    'https://eastasia.api.cognitive.microsoft.com/',
    'https://eastasia.api.cognitive.microsoft.com',
    'https://eastasia.stt.speech.microsoft.com/',
  ])('maps %s to regional speech recognition and overrides legacy resource name', (endpoint) => {
    expect(resolveAzurePronunciationEndpoint({ endpoint, resourceName: 'old-resource', region: 'eastasia' })).toBe(
      'https://eastasia.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1',
    );
  });

  it.each([
    'https://westus.api.cognitive.microsoft.com/',
    'https://westus.stt.speech.microsoft.com/',
    'http://eastasia.api.cognitive.microsoft.com/',
    'https://eastasia.api.cognitive.microsoft.com.evil.test/',
    'https://evil.test/',
    'https://user:password@eastasia.api.cognitive.microsoft.com/',
    'https://eastasia.api.cognitive.microsoft.com:444/',
    'https://eastasia.api.cognitive.microsoft.com/path',
    'https://eastasia.api.cognitive.microsoft.com/?key=secret',
    'https://eastasia.api.cognitive.microsoft.com/#fragment',
    'https://-invalid.cognitiveservices.azure.com/',
  ])('rejects invalid endpoint without falling back to resource name: %s', (endpoint) => {
    expect(resolveAzurePronunciationEndpoint({ endpoint, resourceName: 'old-resource', region: 'eastasia' })).toBeNull();
  });

  it('requires either a valid endpoint or resource name', () => {
    expect(resolveAzurePronunciationEndpoint({ region: 'eastasia' })).toBeNull();
    expect(resolveAzurePronunciationEndpoint({ resourceName: 'invalid/path', region: 'eastasia' })).toBeNull();
  });
});
