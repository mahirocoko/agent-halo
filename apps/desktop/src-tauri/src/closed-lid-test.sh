#!/bin/bash
# Fixed payload embedded in the app. Only the freshly authorized installer can
# enable the override. The durable launchd job is restore-only, including on boot.
set -eu -o pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C TZ=UTC
umask 077
label=com.mahirocoko.agent-halo.closed-lid-test
state=/private/var/db/$label
plist=/Library/LaunchDaemons/$label.plist
worker=$state/worker
owner=$state/owner

pm() {
    # Keep the shared lock inherited by the command. Restoration cannot race a
    # still-running activation. Reap on timeout before the operation can release it.
    /usr/bin/perl -e '
        use POSIX qw(_exit);
        $^F = 1023;
        my $pid = fork();
        defined $pid or exit 71;
        if ($pid == 0) { exec "/usr/bin/pmset", @ARGV or _exit(71); }
        $SIG{ALRM} = sub { kill "KILL", $pid; waitpid($pid, 0); exit 75; };
        alarm 4;
        waitpid($pid, 0) == $pid or exit 71;
        alarm 0;
        exit($? == 0 ? 0 : 71);
    ' -- "$@"
}

power_allows_keep_awake() {
    pm -g batt | /usr/bin/awk -v floor="${1:-0}" '
        /^Now drawing from / { source_count++ }
        $0 == "Now drawing from \047AC Power\047" { ac=1 }
        $0 == "Now drawing from \047Battery Power\047" { battery=1 }
        /-InternalBattery-/ && match($0, /[0-9]+%/) {
            count++
            charge=substr($0, RSTART, RLENGTH-1)+0
        }
        END {
            allowed = ac || (battery && (!floor || (count == 1 && charge >= floor && charge <= 100)))
            exit !(source_count == 1 && allowed)
        }'
}

lid_is_open() {
    /usr/sbin/ioreg -rd1 -c IOPMrootDomain | /usr/bin/grep '"AppleClamshellState" = No$' >/dev/null
}

sleep_setting() {
    pm -g | /usr/bin/awk '
        /^System-wide power settings:/ { header++ }
        $1 == "SleepDisabled" { found++; value=$2 }
        END {
            if (header != 1 || found > 1 || (found && value !~ /^[01]$/)) exit 65
            print found ? value : 0
        }'
}

owner_alive() {
    local pid fingerprint
    { read -r pid; read -r fingerprint; } < "$owner" || return 1
    [[ $pid =~ ^[1-9][0-9]{0,9}$ && -n $fingerprint ]] || return 1
    # A background account cannot hold a machine-wide override after logout
    # or a fast user switch. The normal lock screen retains the console UID.
    [[ ${fingerprint%% *} == "$(/usr/bin/stat -f '%u' /dev/console)" ]] || return 1
    # A stopped or unreaped dead child can still have the same start time.
    [[ $(/bin/ps -p "$pid" -o state= -o uid= -o lstart= | /usr/bin/awk '
        $1 ~ /^[^ZTX]/ && NF >= 7 { $1=""; sub(/^ /, ""); print }') == "$fingerprint" ]]
}

phase() {
    printf '%s\n' "$1" > "$state/phase.tmp"
    /bin/chmod 0644 "$state/phase.tmp"
    /bin/mv -f "$state/phase.tmp" "$state/phase"
}

restore() {
    [[ -e $state/restore-needed ]] || return 0
    phase restoring || true
    pm -a disablesleep 0 || return 1
    [[ $(sleep_setting) == 0 ]] || return 1
    /bin/rm -f "$state/restore-needed" || return 1
    /bin/sync
}

clear_job() {
    # Called by the installer, never by the job it is trying to unload.
    if /bin/launchctl print "system/$label" >/dev/null 2>&1; then
        /bin/launchctl bootout "system/$label" || return 1
        ! /bin/launchctl print "system/$label" >/dev/null 2>&1 || return 1
    fi
    /bin/rm -f "$plist" "$worker" "$state/phase" "$state/phase.tmp" "$owner"
}

installed_job() {
    /bin/launchctl print "system/$label" >/dev/null 2>&1
}

recover_locked() {
    local kind='' seen='' boot=''
    if [[ -e $state/restore-needed ]]; then
        read -r kind seen boot < "$state/phase" || true
        if [[ $kind == active && $seen =~ ^[0-9]{10}$ ]] &&
            [[ -n $boot && $boot == "$(/usr/sbin/sysctl -n kern.bootsessionuuid)" ]] &&
            owner_alive && [[ $(sleep_setting) == 1 ]]; then
            phase "active $(/bin/date +%s) $boot"
            return
        fi
        restore || exit 74
    fi
    # The helper can safely stop itself only after the recovery claim is cleared.
    # If interrupted during cleanup, a subsequent invocation is still restore-only.
    /bin/rm -f "$plist" "$state/phase" "$state/phase.tmp" "$owner"
    /bin/launchctl bootout "system/$label" || true
}

install_locked() {
    local payload=$1 cutoff=$2 caller_uid=$3 caller_pid=$4 caller_fingerprint=$5 battery_floor=$6 now boot
    now=$(/bin/date +%s)
    [[ $cutoff =~ ^[0-9]{10}$ && $caller_uid =~ ^[1-9][0-9]{0,9}$ && $caller_pid =~ ^[1-9][0-9]{0,9}$ && $caller_fingerprint == "$caller_uid "* ]] &&
        [[ $battery_floor =~ ^(0|[1-9][0-9]?|100)$ ]] && (( now <= cutoff )) || exit 65
    # Never replace another active or uncertain override. Staging with no claim
    # cannot have written to pmset and can be retired before a fresh request.
    [[ ! -e $state/restore-needed && $(sleep_setting) == 0 ]] || exit 65
    power_allows_keep_awake "$battery_floor" && lid_is_open || exit 65
    clear_job
    printf '%s\n%s\n' "$caller_pid" "$caller_fingerprint" > "$owner"
    owner_alive || exit 65
    printf '%s\n' "$payload" > "$worker"
    /bin/bash -n "$worker"
    phase "starting $cutoff"
    /bin/cat > "$state/job.tmp" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$label</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>$worker</string><string>recover</string></array>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>3</integer>
<key>ThrottleInterval</key><integer>3</integer>
</dict></plist>
PLIST
    /bin/chmod 0644 "$state/job.tmp"
    /usr/bin/plutil -lint "$state/job.tmp" >/dev/null
    /bin/mv -f "$state/job.tmp" "$plist"
    if ! /bin/launchctl bootstrap system "$plist"; then
        if ! installed_job; then clear_job; fi
        exit 69
    fi
    /bin/sync
    power_allows_keep_awake "$battery_floor" && lid_is_open && [[ $(sleep_setting) == 0 ]] || exit 65
    boot=$(/usr/sbin/sysctl -n kern.bootsessionuuid)
    [[ -n $boot ]] || exit 65
    now=$(/bin/date +%s)
    (( now <= cutoff )) && owner_alive && installed_job || exit 65
    : > "$state/restore-needed"
    /bin/sync
    # Time and recovery ownership are checked again after the durable write.
    if ! power_allows_keep_awake "$battery_floor" || (( $(/bin/date +%s) > cutoff )) || ! installed_job || ! owner_alive ||
        ! pm -a disablesleep 1 || [[ $(sleep_setting) != 1 ]] || ! owner_alive || ! power_allows_keep_awake "$battery_floor"; then
        restore
        exit 69
    fi
    phase "active $(/bin/date +%s) $boot"
}

[[ $(/usr/bin/id -u) == 0 ]] || exit 77
case ${1:-} in
    install|recover)
        if [[ $1 == install && ! -e $state && ! -L $state ]]; then
            /bin/mkdir -m 0755 "$state" || [[ -d $state ]]
        fi
        [[ ! -L $state && -d $state && $(/usr/bin/stat -f '%u:%Lp' "$state") == 0:755 ]] || exit 77
        # The root-only lock inode is retained; every generation uses the same
        # inode so an old job and a new installer cannot overlap their writes.
        exec /usr/bin/perl -e '
            use Fcntl qw(:DEFAULT :flock);
            $^F = 1023;
            my ($gate, $worker, $action, @authorization) = @ARGV;
            my $payload = $authorization[0];
            my $flags = O_RDONLY | O_NOFOLLOW;
            $flags = O_RDWR | O_CREAT | O_NOFOLLOW if $action eq "install";
            sysopen(my $lock, $gate, $flags, 0600) or exit 77;
            my @entry = stat($lock);
            (-f $lock && $entry[4] == 0 && ($entry[2] & 0777) == 0600) or exit 77;
            flock($lock, LOCK_EX | LOCK_NB) or exit 75;
            if ($action eq "install") {
                exec "/bin/bash", "-c", $payload, "agent-halo-closed-lid-test", "install-locked", @authorization;
            } else {
                exec "/bin/bash", $worker, "recover-locked";
            }
            exit 71;
        ' -- "$state/gate" "$worker" "$@"
        ;;
    install-locked) shift; install_locked "$@" ;;
    recover-locked) recover_locked ;;
    *) exit 64 ;;
esac
