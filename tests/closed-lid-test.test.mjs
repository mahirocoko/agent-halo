import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const workerPath = new URL('../apps/desktop/src-tauri/src/closed-lid-test.sh', import.meta.url)
const label = 'com.mahirocoko.agent-halo.closed-lid-test'

// Execute the actual shell control flow and advisory locks, with all power and
// launchd operations redirected to private fixtures. Never invokes sudo.
const setup = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'halo-lid-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const state = join(root, label)
  const daemon = join(root, `${label}.plist`)
  const flag = (key) => join(root, key)
  const put = (key, value) => writeFileSync(flag(key), `${value}\n`)
  const shellMock = (name, body) => {
    writeFileSync(flag(name), `#!/bin/bash\nset -eu\nroot='${root}'\n${body}\n`)
    chmodSync(flag(name), 0o700)
  }
  put('value', 0)
  put('clock', 1795490000)
  put('boot', 'boot-first')
  put('source', 'Battery Power')
  put('charge', 80)
  const fingerprint = `${process.getuid()} Tue Nov 24 14:00:00 2026`
  put('owner-fingerprint', fingerprint)
  put('owner-state', 'S')
  shellMock(
    'ps',
    `[[ $* == '-p ${process.pid} -o state= -o uid= -o lstart=' ]]; printf '%s %s\\n' "$(<"$root/owner-state")" "$(/bin/cat "$root/owner-fingerprint")"`,
  )
  shellMock(
    'pmset',
    `
    if [[ $* == '-g batt' ]]; then
      printf "Now drawing from '%s'\\n -InternalBattery-0 %s%%\\n" "$(<"$root/source")" "$(<"$root/charge")"
    elif [[ $* == '-g' ]]; then
      printf 'System-wide power settings:\\n SleepDisabled %s\\n' "$(<"$root/value")"
    elif [[ $* == '-a disablesleep 1' || $* == '-a disablesleep 0' ]]; then
      # Every mutation needs a loaded recovery job and a durable claim.
      [[ -f "$root/loaded" && -f "$root/${label}/restore-needed" ]]
      printf '%s\\n' "$3" >> "$root/writes"
      if [[ $3 == 1 && -f $root/hang-on ]]; then exec /bin/sleep 30; fi
      if [[ $3 == 0 && -f $root/fail-restore ]]; then exit 42; fi
      printf '%s\\n' "$3" > "$root/value"
    else
      exit 42
    fi`,
  )
  shellMock(
    'launchctl',
    `
    case "$1" in
      print) [[ -f $root/loaded ]] ;;
      bootstrap) [[ -f $3 && ! -f $root/loaded ]]; : > "$root/loaded" ;;
      bootout) /bin/rm -f "$root/loaded" ;;
      *) exit 42 ;;
    esac`,
  )
  shellMock('ioreg', `printf '"AppleClamshellState" = No\\n'`)
  put('console-uid', process.getuid())
  shellMock('stat-root', 'if [[ $3 == /dev/console ]]; then /bin/cat "$root/console-uid"; else /bin/echo 0:755; fi')
  shellMock('id-root', '/bin/echo 0')
  shellMock('date', '/bin/cat "$root/clock"')
  shellMock('sysctl', '/bin/cat "$root/boot"')
  const production = readFileSync(workerPath, 'utf8')
  const script = production
    .replaceAll('/private/var/db/', `${root}/`)
    .replaceAll('/Library/LaunchDaemons/', `${root}/`)
    .replaceAll('/usr/bin/pmset', flag('pmset'))
    .replaceAll('/bin/launchctl', flag('launchctl'))
    .replaceAll('/bin/ps', flag('ps'))
    .replaceAll('/usr/sbin/ioreg', flag('ioreg'))
    .replaceAll('/usr/sbin/sysctl', flag('sysctl'))
    .replaceAll('/usr/bin/stat', flag('stat-root'))
    .replaceAll('/usr/bin/id', flag('id-root'))
    .replaceAll('/bin/date', flag('date'))
    .replaceAll('/bin/sync', '/usr/bin/true')
    .replace('$entry[4] == 0', `$entry[4] == ${process.getuid()}`)
  const run = (args) => spawnSync('/bin/bash', ['-c', script, 'worker', ...args], { encoding: 'utf8', timeout: 9000 })
  const install = (cutoff = 1795490030, batteryFloor = 0) =>
    run([
      'install',
      script,
      String(cutoff),
      String(process.getuid()),
      String(process.pid),
      fingerprint,
      String(batteryFloor),
    ])
  const recover = () => run(['recover'])
  const value = () => readFileSync(flag('value'), 'utf8').trim()
  const phase = () => readFileSync(join(state, 'phase'), 'utf8').trim()
  const writes = () => (existsSync(flag('writes')) ? readFileSync(flag('writes'), 'utf8').trim() : '')
  return { daemon, state, flag, put, install, recover, value, phase, writes, fingerprint }
}

const succeeds = (result) => assert.equal(result.status, 0, result.error?.message ?? result.stderr)

test('closed-lid mode stays active without a timer and restores when the owner exits or its PID is reused', {
  skip: process.platform !== 'darwin',
}, (t) => {
  const fixture = setup(t)
  fixture.put('charge', 19)
  succeeds(fixture.install())
  assert.equal(fixture.value(), '1')
  assert.equal(fixture.phase(), 'active 1795490000 boot-first')
  fixture.put('charge', 3)
  fixture.put('clock', 1795493600)
  succeeds(fixture.recover())
  assert.equal(fixture.writes(), '1')
  assert.equal(fixture.phase(), 'active 1795493600 boot-first')
  fixture.put('owner-fingerprint', `${process.getuid()} Tue Nov 24 15:00:00 2026`)
  succeeds(fixture.recover())
  assert.equal(fixture.value(), '0')
  assert.equal(fixture.writes(), '1\n0')
  assert.equal(existsSync(fixture.daemon), false)
  assert.equal(existsSync(fixture.flag('loaded')), false)
  succeeds(fixture.recover())
  assert.equal(fixture.writes(), '1\n0')
})

test('closed-lid recovery retains its claim on failure and retries after restart', {
  skip: process.platform !== 'darwin',
}, (t) => {
  const fixture = setup(t)
  succeeds(fixture.install())
  fixture.put('boot', 'boot-next')
  fixture.put('fail-restore', 'yes')
  assert.notEqual(fixture.recover().status, 0)
  assert.equal(fixture.phase(), 'restoring')
  assert.equal(fixture.value(), '1')
  assert.equal(existsSync(join(fixture.state, 'restore-needed')), true)
  assert.notEqual(fixture.install().status, 0)
  rmSync(fixture.flag('fail-restore'))
  succeeds(fixture.recover())
  assert.equal(fixture.writes(), '1\n0\n0')
  assert.equal(fixture.value(), '0')
})

test('closed-lid installer rejects expired approval, preexisting overrides and unknown power', {
  skip: process.platform !== 'darwin',
}, (t) => {
  const fixture = setup(t)
  assert.notEqual(fixture.install(1795489999).status, 0)
  fixture.put('value', 1)
  assert.notEqual(fixture.install().status, 0)
  fixture.put('value', 0)
  fixture.put('source', 'Unknown Power')
  assert.notEqual(fixture.install().status, 0)
  assert.equal(fixture.writes(), '')
  assert.equal(existsSync(fixture.daemon), false)
  fixture.put('source', 'Battery Power')
  fixture.put('owner-fingerprint', `${process.getuid()} Tue Nov 24 15:00:00 2026`)
  assert.notEqual(fixture.install().status, 0)
  assert.equal(fixture.writes(), '')
})

test('a hung activation is reaped before the restoration write', { skip: process.platform !== 'darwin' }, (t) => {
  const fixture = setup(t)
  fixture.put('hang-on', 'yes')
  const result = fixture.install()
  assert.equal(result.status, 69, result.error?.message ?? result.stderr)
  assert.equal(fixture.writes(), '1\n0')
  assert.equal(fixture.value(), '0')
  succeeds(fixture.recover())
  assert.equal(existsSync(fixture.flag('loaded')), false)
})

test('closing the lease requests restoration without another authorization', {
  skip: process.platform !== 'darwin',
}, (t) => {
  const fixture = setup(t)
  succeeds(fixture.install())
  rmSync(fixture.flag('owner-fingerprint'))
  fixture.put('fail-restore', 'yes')
  assert.notEqual(fixture.recover().status, 0)
  assert.equal(fixture.phase(), 'restoring')
  assert.equal(fixture.value(), '1')
  rmSync(fixture.flag('fail-restore'))
  succeeds(fixture.recover())
  assert.equal(fixture.writes(), '1\n0\n0')
  assert.equal(fixture.value(), '0')
  fixture.put('owner-fingerprint', fixture.fingerprint)
  succeeds(fixture.install())
  succeeds(fixture.recover())
  assert.equal(fixture.value(), '1')
})

test('a zombie or stopped lease cannot keep the override active', { skip: process.platform !== 'darwin' }, (t) => {
  for (const state of ['Z', 'T']) {
    const fixture = setup(t)
    succeeds(fixture.install())
    fixture.put('owner-state', state)
    succeeds(fixture.recover())
    assert.equal(fixture.value(), '0')
    assert.equal(fixture.writes(), '1\n0')
  }
})

test('late approval below an armed threshold is rejected; equality is allowed', {
  skip: process.platform !== 'darwin',
}, (t) => {
  const fixture = setup(t)
  fixture.put('charge', 19)
  assert.notEqual(fixture.install(1795490030, 20).status, 0)
  assert.equal(fixture.writes(), '')
  fixture.put('charge', 20)
  succeeds(fixture.install(1795490030, 20))
  assert.equal(fixture.value(), '1')
})

test('switching console users ends the old account override', { skip: process.platform !== 'darwin' }, (t) => {
  const fixture = setup(t)
  succeeds(fixture.install())
  fixture.put('console-uid', process.getuid() + 1)
  succeeds(fixture.recover())
  assert.equal(fixture.writes(), '1\n0')
  assert.notEqual(fixture.install().status, 0)
})

test('closed-lid mode starts on AC below the armed floor, survives power changes, and stops on AC', {
  skip: process.platform !== 'darwin',
}, (t) => {
  const fixture = setup(t)
  fixture.put('source', 'AC Power')
  fixture.put('charge', 19)
  succeeds(fixture.install(1795490030, 20))
  assert.equal(fixture.value(), '1')

  // Low-battery sleep is evaluated separately by Halo against live battery state.
  fixture.put('charge', 40)
  for (const source of ['Battery Power', 'AC Power']) {
    fixture.put('source', source)
    succeeds(fixture.recover())
    assert.equal(fixture.value(), '1')
    assert.equal(fixture.writes(), '1')
  }
  rmSync(fixture.flag('owner-fingerprint'))
  succeeds(fixture.recover())
  assert.equal(fixture.value(), '0')
  assert.equal(fixture.writes(), '1\n0')
})
