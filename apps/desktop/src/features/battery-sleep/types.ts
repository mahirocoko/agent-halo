export type BatterySleepStatus = {
  supported: boolean
  armed: boolean
  error: string | null
  batteryLevel: number | null
  isBatteryPowered: boolean | null
}
