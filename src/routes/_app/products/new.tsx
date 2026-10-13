import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'

import { Page, PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'
import { ProductForm } from '@/features/products/product-form'
import { auth } from '@/lib/auth'

export const Route = createFileRoute('/_app/products/new')({
  // Нет права — на экран вообще не пускаем (а сервер всё равно ответил бы 403).
  beforeLoad: () => {
    if (!auth.can('products.create')) throw redirect({ to: '/products' })
  },
  component: NewProductPage,
})

function NewProductPage() {
  const navigate = useNavigate()
  return (
    <Page>
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start text-muted-foreground">
        <Link to="/products">
          <ArrowLeftIcon /> Товары
        </Link>
      </Button>
      <PageHeader title="Новый товар" description="Создаётся черновиком — в продажу попадёт, когда смените статус" />
      <ProductForm canEdit onSaved={(product) => void navigate({ to: '/products/$productId', params: { productId: product.id }, replace: true })} />
    </Page>
  )
}
