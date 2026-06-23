import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n.ts')

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@social/shared', '@social/i18n'],
}

export default withNextIntl(nextConfig)
