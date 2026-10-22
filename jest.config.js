/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/apps/api-gateway/test/**/*.spec.ts'],
  modulePathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/.nx/', '<rootDir>/tmp/'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.base.json',
      },
    ],
  },
  moduleNameMapper: {
    '^@skillup/shared/common$': '<rootDir>/libs/shared/common/src/index.ts',
    '^@skillup/shared/constants$': '<rootDir>/libs/shared/constants/src/index.ts',
    '^@skillup/shared/enums$': '<rootDir>/libs/shared/enums/src/index.ts',
    '^@skillup/shared/types$': '<rootDir>/libs/shared/types/src/index.ts',
    '^@skillup/shared/interfaces$': '<rootDir>/libs/shared/interfaces/src/index.ts',
    '^@skillup/shared/entities$': '<rootDir>/libs/shared/entities/src/index.ts',
    '^@skillup/shared/redis$': '<rootDir>/libs/shared/redis/src/index.ts',
    '^@skillup/shared/rabbitmq$': '<rootDir>/libs/shared/rabbitmq/src/index.ts',
    '^@skillup/shared/(.*)$': '<rootDir>/libs/shared/$1',
    '^@skillup/shared$': '<rootDir>/libs/shared/src/index.ts',
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  verbose: true,
  testTimeout: 30000,
};
