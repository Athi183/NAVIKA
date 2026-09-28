import { QRCodeSVG } from 'qrcode.react'

export default function QRDisplay({ value = 'https://navika.demo/route' }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-center">
      <div className="mx-auto flex h-52 w-52 items-center justify-center rounded-2xl bg-white p-3 shadow-inner shadow-slate-200">
        <QRCodeSVG value={value} size={180} bgColor="#ffffff" fgColor="#0f172a" />
      </div>
    </div>
  )
}
