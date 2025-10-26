export const awsConfig = {
  Auth: {
    Cognito: {
      userPoolId: 'us-east-1_9OBgI0F3T',
      userPoolClientId: '2llu1k23bskrmk0fclljoiphmr',
      region: 'us-east-1',
      loginWith: {
        email: true,
        username: true,
      },
      signUpVerificationMethod: 'code',
      userAttributes: {
        email: {
          required: true
        }
      },
      allowGuestAccess: false,
      passwordFormat: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireNumbers: true,
        requireSpecialCharacters: true
      }
    }
  }
};