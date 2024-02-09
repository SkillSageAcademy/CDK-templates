import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';


export interface StickySessionsMultiRegionProps extends cdk.StackProps {
    readonly CertificateArn: string,
    readonly HealthCheckPath: string;
    readonly HealthCheckPort: string;
    readonly HealthCheckHttpCodes: string;
}

export class StickySessionsMultiRegionStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: StickySessionsMultiRegionProps) {
        super(scope, id, props);

        // Create a VPC
        const vpc = new ec2.Vpc(this, 'MyVPC', {
            maxAzs: 2, // Maximum Availability Zones
            subnetConfiguration: [
                {
                    cidrMask: 24,
                    name: 'Public',
                    subnetType: ec2.SubnetType.PUBLIC,
                },
                {
                    cidrMask: 24,
                    name: 'Private',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                },
            ]
        });

        // Security group for ElastiCache
        const cacheSecurityGroup = new ec2.SecurityGroup(this, 'CacheSecurityGroup', {
            vpc: vpc,
            description: 'Security group for ElastiCache',
        });

        // Allow inbound traffic from EC2 instance
        cacheSecurityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(6379), 'Allow inbound from VPC');

        // Create ElastiCache cluster
        const cacheCluster = new elasticache.CfnCacheCluster(this, 'MyCacheCluster', {
            cacheNodeType: 'cache.t2.micro', // Adjust as per your requirements
            engine: 'redis', // Adjust as per your requirements
            numCacheNodes: 1, // Adjust as per your requirements
            vpcSecurityGroupIds: [cacheSecurityGroup.securityGroupId], // You may need to provide security group IDs
            cacheSubnetGroupName: 'my-cache-subnet-group', // You may need to provide a subnet group name
            clusterName: 'my-cache-cluster', // Adjust as per your requirements
        });

        // Create Redis Subnet Group based on the VPC Private Subnets
        const redisSubnetGroup = new elasticache.CfnSubnetGroup(
            this,
            `redisSubnetGroup`,
            {
                description: "Subnet group for the redis cluster",
                subnetIds: vpc.privateSubnets.map((ps) => ps.subnetId),
                cacheSubnetGroupName: "GT-Redis-Subnet-Group",
            }

        );
        cacheCluster.addDependency(redisSubnetGroup)

        // Create an Application Load Balancer
        const alb = new elbv2.ApplicationLoadBalancer(this, 'MyALB', {
            vpc,
            internetFacing: true, // Enable internet-facing
            vpcSubnets: {
                subnetType: ec2.SubnetType.PUBLIC, // Use public subnets
            },
        });

        // Add a listener to the ALB
        const listener = alb.addListener('Listener', {
            port: 80,
            open: true,
        });

        const httpsListener = alb.addListener('ALBListenerHttps', {
            certificates: [elbv2.ListenerCertificate.fromArn(props.CertificateArn)],
            protocol: elbv2.ApplicationProtocol.HTTPS,
            port: 443,
            sslPolicy: elbv2.SslPolicy.TLS12
        })

        // Create an IAM role for EC2 instances
        const instanceRole = new iam.Role(this, 'InstanceRole', {
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
        });

        // Policy granting permission to access ElastiCache
        const policy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'elasticache:DescribeCacheClusters',
                'elasticache:DescribeCacheParameterGroups',
                'elasticache:DescribeCacheSecurityGroups',
                'elasticache:DescribeCacheSubnetGroups',
                'elasticache:DescribeEngineVersions',
                'elasticache:DescribeSnapshots',
                'elasticache:ListAllowedNodeTypeModifications',
                'elasticache:ListTagsForResource',
            ],
            resources: ['*'], // Adjust as per your requirements
        });

        // Attach policy to the role
        instanceRole.addToPolicy(policy);

        // Add permissions to the IAM role
        instanceRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));

        // Create an Autoscaling Group
        const asg = new autoscaling.AutoScalingGroup(this, 'MyAutoScalingGroup', {
            vpc,
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
            machineImage: ec2.MachineImage.latestAmazonLinux2(),
            minCapacity: 2, // Minimum number of instances
            maxCapacity: 4, // Maximum number of instances
            desiredCapacity: 2, // Desired number of instances
            role: instanceRole, // Set the IAM role for instances
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, // Use private subnets
            },
        });


        // Add a target group for the ALB
        const targetGroup = new elbv2.ApplicationTargetGroup(this, 'MyTargetGroup', {
            port: 80,
            targets: [asg],
            vpc,
            targetType: elbv2.TargetType.INSTANCE,
            targetGroupName: 'MyTargetGroup', // Set the name of the target group
        });

        // Attach the target group to the listener
        listener.addTargetGroups('TargetGroup', {
            targetGroups: [targetGroup],
        });
        httpsListener.addTargets('TargetGroup', {
            port: 443,
            protocol: elbv2.ApplicationProtocol.HTTPS,
            targets: [asg],
            loadBalancingAlgorithmType: elbv2.TargetGroupLoadBalancingAlgorithmType.LEAST_OUTSTANDING_REQUESTS,
            healthCheck: {
                path: props.HealthCheckPath,
                port: props.HealthCheckPort,
                healthyHttpCodes: props.HealthCheckHttpCodes
            }
        })

        // Add the ALB security group to the Autoscaling Group
        alb.connections.allowFromAnyIpv4(ec2.Port.tcp(80), 'Allow inbound HTTP traffic from anywhere');
        alb.connections.allowFromAnyIpv4(ec2.Port.tcp(443), 'Allow inbound HTTPS traffic from anywhere');
        asg.connections.allowTo(alb, ec2.Port.tcp(80), 'Allow outbound HTTP traffic to ALB');
    }
}