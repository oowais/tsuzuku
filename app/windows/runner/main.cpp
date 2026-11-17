#include <flutter/dart_project.h>
#include <flutter/flutter_view_controller.h>
#include <flutter_windows.h>
#include <windows.h>

#include <algorithm>

#include "flutter_window.h"
#include "utils.h"

int APIENTRY wWinMain(_In_ HINSTANCE instance, _In_opt_ HINSTANCE prev,
                      _In_ wchar_t *command_line, _In_ int show_command) {
  // Attach to console when present (e.g., 'flutter run') or create a
  // new console when running with a debugger.
  if (!::AttachConsole(ATTACH_PARENT_PROCESS) && ::IsDebuggerPresent()) {
    CreateAndAttachConsole();
  }

  // Initialize COM, so that it is available for use in the library and/or
  // plugins.
  ::CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

  flutter::DartProject project(L"data");

  std::vector<std::string> command_line_arguments =
      GetCommandLineArguments();

  project.set_dart_entrypoint_arguments(std::move(command_line_arguments));

  FlutterWindow window(project);
  // Opens phone-shaped: a third of the primary screen's work area wide (at least 400), its full height, at its
  // left edge. Create() takes logical pixels and scales them by the monitor's DPI, so the work area is divided
  // back first.
  Win32Window::Point origin(10, 10);
  Win32Window::Size size(420, 860);
  HMONITOR monitor = ::MonitorFromPoint({0, 0}, MONITOR_DEFAULTTOPRIMARY);
  MONITORINFO info{sizeof(MONITORINFO)};
  if (::GetMonitorInfo(monitor, &info)) {
    const double scale = FlutterDesktopGetDpiForMonitor(monitor) / 96.0;
    const RECT &work = info.rcWork;
    origin = Win32Window::Point(static_cast<unsigned int>(work.left / scale),
                                static_cast<unsigned int>(work.top / scale));
    const unsigned int width =
        static_cast<unsigned int>((work.right - work.left) / scale / 3);
    size = Win32Window::Size(std::max(width, 400u),
                             static_cast<unsigned int>((work.bottom - work.top) / scale));
  }
  if (!window.Create(L"Tsuzuku", origin, size)) {
    return EXIT_FAILURE;
  }
  window.SetQuitOnClose(true);

  ::MSG msg;
  while (::GetMessage(&msg, nullptr, 0, 0)) {
    ::TranslateMessage(&msg);
    ::DispatchMessage(&msg);
  }

  ::CoUninitialize();
  return EXIT_SUCCESS;
}
