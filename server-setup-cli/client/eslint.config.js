//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'

export default [
  ...tanstackConfig,
  {
    ignores: ['.output/**', 'dist/**', 'build/**', '*.config.js'],
  },
]
