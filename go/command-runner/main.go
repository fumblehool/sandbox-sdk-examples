// command-runner runs a shell command in a fresh sandbox and exits with the
// command's exit code. Use it from a Go service or a Makefile to run work in
// isolation.
//
//	export DIGITALOCEAN_ACCESS_TOKEN=...
//	go run . 'python3 -c "print(sum(range(10**6)))"'
//	go run . -no-internet 'curl -sS --max-time 5 https://example.com || echo blocked'
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"time"

	"github.com/digitalocean/godo/sandbox"
)

func main() {
	template := flag.String("template", "", "template name (default coding-base)")
	noInternet := flag.Bool("no-internet", false, "limit outbound network access")
	timeout := flag.Duration("timeout", 2*time.Minute, "kill the command after this long")
	flag.Parse()
	if flag.NArg() != 1 {
		fmt.Fprintln(os.Stderr, "usage: command-runner [flags] '<shell command>'")
		os.Exit(2)
	}

	os.Exit(run(*template, *noInternet, *timeout, flag.Arg(0)))
}

func run(template string, noInternet bool, timeout time.Duration, command string) int {
	// Ctrl-C cancels the context, and the deferred Kill below still runs.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	client, err := sandbox.NewClient(nil) // reads DIGITALOCEAN_ACCESS_TOKEN
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 2
	}

	params := &sandbox.CreateParams{Template: template}
	if noInternet {
		allow := false
		params.AllowInternetAccess = &allow
	}
	sb, err := client.Create(ctx, params)
	if err != nil {
		fmt.Fprintln(os.Stderr, "create sandbox:", err)
		return 2
	}
	// Clean up with a fresh context: ctx may already be canceled.
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if _, err := sb.Kill(cleanup); err != nil {
			fmt.Fprintln(os.Stderr, "warning: could not delete sandbox", sb.ID(), err)
		}
	}()
	fmt.Fprintf(os.Stderr, "sandbox %s (%s)\n", sb.ID(), sb.Template())

	code, err := runGated(ctx, sb, command, int64(timeout/time.Second))
	if err != nil {
		fmt.Fprintln(os.Stderr, "run command:", err)
		return 2
	}
	return code
}

// runGated runs a shell command and streams its output. Output can only be
// read while a command runs, and a short command can exit before the stream
// attaches. So the command first waits for a marker file, and a second
// command creates the marker only after the stream delivers its first event
// (or after 3 seconds, if no event comes). The gate does not use stdin,
// because the stdin route is not deployed yet.
func runGated(ctx context.Context, sb *sandbox.Sandbox, command string, timeoutSeconds int64) (int, error) {
	gate := fmt.Sprintf("/tmp/.gate-%d", time.Now().UnixNano())
	script := fmt.Sprintf("for _ in $(seq 600); do [ -e %s ] && break; sleep 0.05; done; rm -f %s\n%s", gate, gate, command)
	cmd, err := sb.Commands.Start(ctx, "bash", &sandbox.StartOptions{
		Args:           []string{"-lc", script},
		TimeoutSeconds: timeoutSeconds,
	})
	if err != nil {
		return 0, err
	}

	var once sync.Once
	var releaseErr error
	release := func() {
		once.Do(func() {
			_, releaseErr = sb.Commands.Start(ctx, "touch", &sandbox.StartOptions{Args: []string{gate}})
		})
	}
	timer := time.AfterFunc(3*time.Second, release)
	defer timer.Stop()

	for event, err := range cmd.Events(ctx) {
		if err != nil {
			return 0, err
		}
		release()
		if releaseErr != nil {
			return 0, releaseErr
		}
		switch event.Type {
		case sandbox.EventStdout:
			fmt.Print(event.Text)
		case sandbox.EventStderr:
			fmt.Fprint(os.Stderr, event.Text)
		case sandbox.EventExit:
			return int(event.ExitCode), nil
		}
	}
	return 0, fmt.Errorf("command %d ended without an exit event", cmd.PID)
}
