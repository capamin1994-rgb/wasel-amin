{ pkgs }: {
  deps = [
    pkgs.nodejs-20_x
    pkgs.libuuid
    pkgs.sqlite
    pkgs.python3
    pkgs.gnumake
    pkgs.gcc
    pkgs.git
    pkgs.wget
  ];
}
