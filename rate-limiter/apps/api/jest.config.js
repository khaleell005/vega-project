/** @type {import('jest').Config} */
module.exports = {
  transform: {
    "^.+\\.tsx?$": ["@swc/jest", {}],
  },
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/**/*.test.ts"],
  testTimeout: 30000,
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts"],
};
