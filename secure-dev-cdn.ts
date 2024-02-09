import * as cdk from 'aws-cdk-lib';
import { Duration } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfront_origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as waf from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { Config } from './config/Config';

export interface PropsStaticResources extends cdk.StackProps {
    readonly domainName: string,
    readonly environment: string,
    readonly lambdaEdgeOriginRequest: string,
    readonly hostedZoneId: string,
    readonly certificateArn: string,
}

export class StaticResources extends cdk.Stack {
    constructor(scope: Construct, id: string, props: PropsStaticResources) {
        super(scope, id, props);

        // Retrieve the bucket name from the environment variable
        const domainName = props.domainName
        const subdomain = domainName.split('.')[0];
        const homePage = 'index.html';
        const lambdaEgdeOriginRequest = props.lambdaEdgeOriginRequest;

        // Create a access policy for s3 bucket
        const blockPublicAccess = new s3.BlockPublicAccess({
            restrictPublicBuckets: true,
            blockPublicAcls: true,
            ignorePublicAcls: true,
            blockPublicPolicy: true
        })

        // Create a Private S3 Bucket with Public ACL for new objects enabled and Static Webhosting Enabled
        // ObjectWriter
        const bucket = new s3.Bucket(this, domainName + 'Bucket', {
            bucketName: domainName,
            publicReadAccess: false,
            blockPublicAccess: blockPublicAccess,
            versioned: true,
            objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
        });

        const cloudfrontOAI = new cloudfront.OriginAccessIdentity(this, domainName + 'cloudfront-OAI', {
            comment: `[${props.environment}] ${Config.project} Static Resources OAI`
        });

        // Fetch the CloudFront Origin Access Identity Principal
        const cloudfrontOAIPrincipal = cloudfrontOAI.cloudFrontOriginAccessIdentityS3CanonicalUserId;

        // Deploy your ACLs or policies to the bucket
        // Adding a bucket policy to allow specific ACLs
        bucket.addToResourcePolicy(new iam.PolicyStatement({
            actions: ['s3:GetObject'],
            effect: iam.Effect.ALLOW,
            principals: [new iam.CanonicalUserPrincipal(cloudfrontOAIPrincipal)],
            resources: [bucket.arnForObjects('*')],
        }));

        // Certificate ARN
        const myCertificate = acm.Certificate.fromCertificateArn(this, domainName + 'HTTPSCertificate', props.certificateArn);

        // Create an Origin Request and Origin Response Lambda Version
        const originRequestFunctionVersion = lambda.Version.fromVersionArn(this, 'OriginRequestFunction', lambdaEgdeOriginRequest);

        // CSP Policy
        const cspPolicy = "default-src https://consentcdn.cookiebot.com/ https://" + domainName + "/;"

        // Creating a custom response headers policy -- all parameters optional
        const myResponseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, subdomain + 'ResponseHeadersPolicy', {
            responseHeadersPolicyName: subdomain + 'ResponseHeadersPolicy',
            comment: subdomain + 'ResponseHeadersPolicy',
            corsBehavior: {
                accessControlAllowCredentials: false,
                accessControlAllowHeaders: ['*'],
                accessControlAllowMethods: ['GET', 'POST', 'OPTIONS'],
                accessControlAllowOrigins: [domainName],
                accessControlExposeHeaders: ['*'],
                accessControlMaxAge: Duration.seconds(600),
                originOverride: true,
            },
            securityHeadersBehavior: {
                contentSecurityPolicy: { contentSecurityPolicy: cspPolicy, override: true },
                contentTypeOptions: { override: true },
                frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
                referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER, override: true },
                strictTransportSecurity: { accessControlMaxAge: Duration.seconds(600), includeSubdomains: true, override: true },
                xssProtection: { protection: true, modeBlock: true, override: true },
            },
            removeHeaders: ['Server'],
            serverTimingSamplingRate: 50,
        });

        // Create WAF
        const waf = this.createWAF(props.domainName)

        // Create CloudFront Distribution
        const distribution = new cloudfront.Distribution(this, domainName + 'CDN', {
            defaultBehavior: {
                origin: new cloudfront_origins.S3Origin(bucket, { originAccessIdentity: cloudfrontOAI }),
                compress: true,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                responseHeadersPolicy: myResponseHeadersPolicy,
                edgeLambdas: [
                    {
                        functionVersion: originRequestFunctionVersion,
                        eventType: cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
                    }
                ]
            },
            errorResponses: [
                {
                    httpStatus: 404,
                    responseHttpStatus: 200,
                    responsePagePath: `/${homePage}`,
                },
                {
                    httpStatus: 403,
                    responseHttpStatus: 200,
                    responsePagePath: `/${homePage}`,
                },
            ],
            webAclId: waf.attrArn,
            httpVersion: cloudfront.HttpVersion.HTTP2_AND_3, // Support HTTP2 and 3
            comment: '[' + props.environment + '] ' + Config.project + ' Static Resources',
            minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
            defaultRootObject: homePage,
            certificate: myCertificate,
            domainNames: [domainName],
        });


        // Create a hosted zone object using the hosted zone ID
        const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
            hostedZoneId: props.hostedZoneId,
            zoneName: props.domainName,
        });

        // Create a A record in Route 53 for the custom domain name
        new route53.ARecord(this, domainName + 'ApiARecord', {
            zone: hostedZone,
            recordName: domainName,
            target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution)),
            comment: 'API Gateway A Record for ' + domainName,
            deleteExisting: true
        });

        // Create a Aaaa record in Route 53 for the custom domain name
        new route53.AaaaRecord(this, domainName + 'ApiAaaaRecord', {
            zone: hostedZone,
            recordName: domainName,
            target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution)),
            comment: 'API Gateway Aaaa Record for ' + domainName,
            deleteExisting: true
        });

        // Output the CloudFront domain name
        new cdk.CfnOutput(this, 'DistributionDomainName', {
            value: distribution.domainName,
        });

        // Add tags to the CloudFront distribution
        cdk.Tags.of(distribution).add('environment', props.environment);
        cdk.Tags.of(distribution).add('author', Config.author);
        cdk.Tags.of(distribution).add('project', Config.project);

        const app = new cdk.App();
        app.synth();
    }


    private createWAF(domainName: string): waf.CfnWebACL {
        // Create IP sets for allowed IPs
        const ipSet1 = new waf.CfnIPSet(this, 'IPSet1', {
            addresses: ['192.0.2.0/24', '198.51.100.0/24'], // Example IPs, replace with your allowed IPs
            ipAddressVersion: 'IPV4',
            scope: 'REGIONAL',
            name: "office IP"
        });

        const ipSet2 = new waf.CfnIPSet(this, 'IPSet2', {
            addresses: ['203.0.113.0/24', '2001:0db8:85a3:0000:0000:8a2e:0370:7334'], // Example IPs, replace with your allowed IPs
            ipAddressVersion: 'IPV6',
            scope: 'REGIONAL',
            name: "remote Consultant Home IP"
        });

        // Create a rule group containing the IP sets
        const ruleGroup = new waf.CfnRuleGroup(this, 'IPRuleGroup', {
            capacity: 100,
            scope: 'REGIONAL',
            name: "Allow these IPs  from office and remote",
            visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: 'IPRuleGroupMetrics',
                sampledRequestsEnabled: true,
            },
            rules: [
                {
                    name: 'AllowFromIPSet1',
                    priority: 1,
                    statement: {
                        ipSetReferenceStatement: {
                            arn: ipSet1.attrArn,
                        },
                    },
                    visibilityConfig: {
                        sampledRequestsEnabled: true,
                        cloudWatchMetricsEnabled: true,
                        metricName: 'AllowFromIPSet1',
                    },
                },
                {
                    name: 'AllowFromIPSet2',
                    priority: 2,
                    statement: {
                        ipSetReferenceStatement: {
                            arn: ipSet2.attrArn,
                        },
                    },
                    visibilityConfig: {
                        sampledRequestsEnabled: true,
                        cloudWatchMetricsEnabled: true,
                        metricName: 'AllowFromIPSet2',
                    },
                },
            ],
        });

        const webACL = new waf.CfnWebACL(this, domainName + 'MyWebACL', {
            description: "API ACL for the " + domainName + " API Gateway",
            defaultAction: { block: {} }, // blocks all requests by default
            scope: 'REGIONAL',
            visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: 'MyWebACLMetrics',
                sampledRequestsEnabled: true,
            },
            rules: [
                {
                    name: 'IPRuleGroupRule',
                    priority: 1,
                    statement: {
                        ruleGroupReferenceStatement: {
                            arn: ruleGroup.attrArn,
                        },
                    },
                    visibilityConfig: {
                        sampledRequestsEnabled: true,
                        cloudWatchMetricsEnabled: true,
                        metricName: 'IPRuleGroupRule',
                    },
                },
            ],
        });

        return webACL
    }
}
