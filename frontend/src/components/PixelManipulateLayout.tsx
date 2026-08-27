import type { ReactNode } from 'react'

type PixelManipulateModule = {
  key: string
  title: string
  description?: ReactNode
  content: ReactNode
}

type PixelManipulateLayoutProps = {
  children?: ReactNode
  introduction?: ReactNode
  modules?: PixelManipulateModule[]
  footer?: ReactNode
}

export function PixelManipulateLayout({ children, introduction, modules = [], footer }: PixelManipulateLayoutProps) {
  return <div className="pixel-manipulate-layout">
    {children}
    {introduction}
    {modules.map((module, index) => <section className="pixel-manipulate-layout__module" aria-labelledby={`pixel-manipulate-${module.key}`} key={module.key}>
      <div className="pixel-manipulate-layout__heading">
        <span aria-hidden="true">{index + 1}</span>
        <div><h3 id={`pixel-manipulate-${module.key}`}>{module.title}</h3>{module.description ? <p>{module.description}</p> : null}</div>
      </div>
      {module.content}
    </section>)}
    {footer}
  </div>
}
