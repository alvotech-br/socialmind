import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'SocialMind',
  description: 'Gerencie suas redes sociais em um único lugar',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html suppressHydrationWarning>
      <body>{children}</body>
    </html>
  )
}
