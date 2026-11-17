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
  // Opens at 543x949 logical pixels, 993 from the left and 49 from the top of the primary screen's work area,
  // shrunk and moved to fit a smaller work area. Create() takes logical pixels and scales them by the monitor's
  // DPI, so the work area is divided back first.
  Win32Window::Point origin(993, 49);
  Win32Window::Size size(543, 949);
  HMONITOR monitor = ::MonitorFromPoint({0, 0}, MONITOR_DEFAULTTOPRIMARY);
  MONITORINFO info{sizeof(MONITORINFO)};
  if (::GetMonitorInfo(monitor, &info)) {
    const double scale = FlutterDesktopGetDpiForMonitor(monitor) / 96.0;
    const RECT &work = info.rcWork;
    const int left = static_cast<int>(work.left / scale);
    const int top = static_cast<int>(work.top / scale);
    const int width = static_cast<int>((work.right - work.left) / scale);
    const int height = static_cast<int>((work.bottom - work.top) / scale);
    const int w = std::min(543, width);
    const int h = std::min(949, height);
    const int x = left + std::clamp(993, 0, width - w);
    const int y = top + std::clamp(49, 0, height - h);
    origin = Win32Window::Point(static_cast<unsigned int>(x), static_cast<unsigned int>(y));
    size = Win32Window::Size(static_cast<unsigned int>(w), static_cast<unsigned int>(h));
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
