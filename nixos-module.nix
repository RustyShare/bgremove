# NixOS module exposing bgremove as a systemd service.
#
# Enable with, e.g.:
#   services.bgremove = {
#     enable = true;
#     nginx = {
#       enable = true;
#       fqdn = "bgremove.example.com";
#       enableACME = true;   # Let's Encrypt cert + force HTTPS
#     };
#   };
#
# `self` is this flake, used to default the package to the flake's build.
{ self }:
{ config, lib, pkgs, ... }:

let
  cfg = config.services.bgremove;
  # nginx must proxy to a reachable address; 0.0.0.0 isn't connectable.
  proxyHost = if cfg.host == "0.0.0.0" then "127.0.0.1" else cfg.host;
in
{
  options.services.bgremove = {
    enable = lib.mkEnableOption "the bgremove background-removal web service";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      defaultText = lib.literalExpression "bgremove flake package";
      description = "The bgremove package to run.";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Address the web server binds to.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8000;
      description = "Port the web server listens on.";
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Open {option}`port` in the firewall.";
    };

    nginx = {
      enable = lib.mkEnableOption "an nginx reverse-proxy virtualHost for bgremove";

      fqdn = lib.mkOption {
        type = lib.types.str;
        default = "";
        example = "bgremove.example.com";
        description = ''
          Fully-qualified domain name for the nginx virtualHost that proxies to
          the bgremove service.
        '';
      };

      enableACME = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = ''
          Obtain a Let's Encrypt certificate for {option}`fqdn` via ACME and
          redirect HTTP to HTTPS. Requires accepting the ACME terms elsewhere
          (e.g. {option}`security.acme.acceptTerms`).
        '';
      };

      forceSSL = lib.mkOption {
        type = lib.types.bool;
        default = cfg.nginx.enableACME;
        defaultText = lib.literalExpression "config.services.bgremove.nginx.enableACME";
        description = "Only serve over HTTPS (redirect HTTP).";
      };
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.bgremove = {
      description = "bgremove background-removal web service";
      wantedBy = [ "multi-user.target" ];
      # First request for a model downloads it (~170 MB), so we need network.
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];

      environment = {
        BGREMOVE_HOST = cfg.host;
        BGREMOVE_PORT = toString cfg.port;
        # rembg caches downloaded models here; keep it in the service state dir.
        U2NET_HOME = "/var/lib/bgremove/models";
        # numba (via pymatting, for alpha matting) needs a writable cache dir;
        # the package ships in the read-only Nix store. Persist it in state.
        NUMBA_CACHE_DIR = "/var/lib/bgremove/numba-cache";
      };

      serviceConfig = {
        ExecStart = lib.getExe' cfg.package "bgremove-web";
        DynamicUser = true;
        StateDirectory = "bgremove";
        Restart = "on-failure";

        # Hardening.
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        PrivateDevices = true;
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectControlGroups = true;
        RestrictAddressFamilies = [ "AF_INET" "AF_INET6" ];
        RestrictNamespaces = true;
        LockPersonality = true;
        MemoryDenyWriteExecute = false; # onnxruntime needs W^X exceptions
      };
    };

    # Open the service port directly when requested, and 80/443 when nginx
    # fronts it (a single definition — the attribute can't be set twice).
    networking.firewall.allowedTCPPorts =
      lib.optional cfg.openFirewall cfg.port
      ++ lib.optionals cfg.nginx.enable ([ 80 ] ++ lib.optional cfg.nginx.forceSSL 443);

    assertions = [
      {
        assertion = cfg.nginx.enable -> cfg.nginx.fqdn != "";
        message = "services.bgremove.nginx.fqdn must be set when nginx is enabled.";
      }
    ];

    # Everything we contribute to services.nginx is set at default priority
    # (lib.mkDefault) so it merges with — and never overrides — nginx/ACME
    # config you already provide. Override any of these in your own config and
    # your value wins.
    services.nginx = lib.mkIf cfg.nginx.enable {
      enable = lib.mkDefault true;
      recommendedProxySettings = lib.mkDefault true;
      virtualHosts.${cfg.nginx.fqdn} = {
        enableACME = lib.mkDefault cfg.nginx.enableACME;
        forceSSL = lib.mkDefault cfg.nginx.forceSSL;
        locations."/" = {
          proxyPass = lib.mkDefault "http://${proxyHost}:${toString cfg.port}";
          # Match the app's 25 MB upload limit so nginx doesn't 413 large images.
          extraConfig = lib.mkDefault "client_max_body_size 25m;";
        };
      };
    };
  };
}
