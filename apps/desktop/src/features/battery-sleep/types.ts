export type BatterySleepStatus = {
  supported: boolean
  armed: boolean
  thresholdPercent: number
  error: string | null
  batteryLevel: number | null
  isBatteryPowered: boolean | null
}
