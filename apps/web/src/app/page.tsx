import { redirect } from 'next/navigation'

// O middleware redireciona /  para /pt-BR, mas caso caia aqui:
export default function Page() {
  redirect('/pt-BR/login')
}
